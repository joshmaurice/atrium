# Pre-brief: Edit mode polish 3 (small fixes after library-sky)

Status: **DRAFT, Revision 1 (2026-10-22). Decisions L1–L6 open (§3).**
- **Rev 1 applies an outside review of Rev 0** (verdict "revise before
  implementation, no major redesign"). There were three must-fix and three
  should-fix findings and one nit, all taken; §11 lists them. The reviewer
  agrees with every recommended decision.
- **Drafted by Claude from `main` at `1206a52`.** Its code is identical to
  the released `a31c5a62` (DEV, MAIN and PROD): `git diff --stat a31c5a62
  1206a52` shows only the library-sky passdown. Claims marked *probe* were
  run against the real modules with throwaway scripts (not committed).
- **Board and host:** release `COMPLETE` at `a31c5a62`; nothing open on the
  board; only `main` on the remote.
- **Sources:**
  - library-sky passdown (10-22) §6.2, items 1 and 3–5;
  - edit-polish-2 passdown (10-19) §5.1, items 1–4: the key guard,
    form-state tests, the stale error, and the spawn hint.
- **Scope:** `apps/client` and `packages/renderer-three` only. There is no
  server, protocol, SOM or `packages/client` change, so no DEV restart.
- **Out of scope:** everything else in those lists:
  - the SOM Inspector's models;
  - a raw World Info send that's refused not being rolled back;
  - the §9.5 forward-write race;
  - L31 lighting;
  - the identity-replace `loading/aborted` case;
  - the world list's name (§9.2).
- Line numbers are approximate, at `1206a52`.

## 1. What this round is
1. **The HUD's world name follows a rename.** Today it changes only on a
   reconnect.
2. **Turning Edit off closes the Model form and the Library grid,** as
   their specs said, and discards the Model form's typed URL. Today they're
   only hidden with the panel, and they reappear when Edit is turned back
   on. **Also:** an add whose form has closed no longer grabs the selection
   when its answer arrives late (Rev 1).
3. **The destination (teleporter) form becomes its own module, with
   committed tests.** It is the last Edit-panel form whose logic still lives
   inside `app.js`. The move also fixes two of its bugs:
   - a failed Save's error stays on screen while the retry says "Saving…";
   - a world list that arrives late can be added to a newer list.
4. **A refused sky is logged once, not on every World Info change.**
5. **A catalog sky is named in the picker for a viewer on another server,**
   instead of showing as "Custom".
6. **The key-wiring guard closes its two blind spots:** a capture argument
   after the handler, and a consume call that is commented out.
7. **Optional (L5):** a spawn-point note when a selected teleporter sits
   near spawn.

## 2. What the code does today (at `1206a52`)

### P1. The HUD's world name (item 1)
- `app.js` L668 in the `world:loaded` handler (L641) sets
  `hudWorldEl.textContent = name ? \`World: ${name}\` : ''`. The name is
  `extras.atrium.name` of the document root (`AtriumClient` L770, L1297,
  L1350).
- **A rename arrives as `som:set` with `nodeName === '__document__'`.** For
  example, the SOM Inspector's World Info panel writes the root's
  `extras.atrium`.
  - The handler's document branch (L825) re-syncs the sky picker and the sky
    and returns, and never touches the HUD.
  - `world:loaded` doesn't repeat for a rename, so the HUD keeps the old
    name until the next connection. This is what the operator saw at
    library-sky acceptance.
- `hudWorldEl.textContent` is written in exactly one place.

### P2. Edit off and the panel's forms (item 2)
- `setEditMode(false)` (L1640) closes the destination form
  (`closeTeleporterForm()`, L1654), clears the selection and hides the panel.
  **It doesn't close the Model form or the Library grid.**
- Only `endEditSession()` (L1673) does, for a world load or a reconnect. Its
  comments say "Z7 — Edit off closes the Model form too" and "Z2 — and the
  Library grid", but the code that runs on Edit off isn't there.
- **Effect:** with Edit off, the hidden form or grid stays `isOpen()`. With
  Edit back on, it's showing again with its old state: a typed URL and a
  held Check result, or a grid page.
  - The Edit panel's spec (models-by-url Z7, library-sky Z2) says both close
    on Edit off.
  - A Save already sent keeps its undo entry either way: both `close()`s
    "forget the form's wait only" (`model-form.js` L342).
- **The Model form's typed URL survives a close, and its input box survives
  even a reset** (review 1, confirmed).
  - `close()` (`model-form.js` L343) clears the Check result, the error and
    the wait, but not `state.url`.
  - `reset()` (L366) clears `state.url`, but **nothing in the module ever
    writes `elements.url.value`**: the only use of the input is its `input`
    listener (L377).
  - So after a reconnect the box still shows the old URL while the form's
    state is empty. A merely closed form keeps both.
- **An add whose form has closed is still selected when it's accepted**
  (review 2, confirmed, and wider than the review says).
  - The Model form's `onAnswer` (L309) returns `false` for an answer it no
    longer owns.
  - The destination form's branch (`app.js` L2351) only closes the form when
    it's still waiting.
  - In both cases `onStructureAnswer` falls through to the generic `else if
    (status === 'accepted' && request.kind !== 'delete' && modes.edit)
    selectAdded(request.name)` (L2398).
  - **Sequence:** Save; Edit off, which closes the form; Edit on; select
    something else; then the acceptance arrives and replaces the selection.
  - The Library grid alone returns before the generic branch (L2345), so it
    already behaves as intended.
- **The three forms already share one gate,** `createFormGate()`
  (`model-form.js` L83). At most one is open, and each registered a closer:
  - `teleporter` at L2722;
  - `model` at L2905;
  - `library` at L3032.

  The gate has no "close whatever is open" call.

### P3. The destination form lives in `app.js` (item 3)
- **Its state and handlers are spread over `app.js`:**
  - `formWaitSeq` (L1195) and `pendingPosition` (L1237);
  - `closeTeleporterForm` (L1197);
  - the Teleporter button (L1320) and `openTeleporterForm` (L1339);
  - the input listeners (L1393–1403) and Save (L1405);
  - the answer branch in `onStructureAnswer` (L2351–2367);
  - Escape's "ignored while saving" (L1281).

  `buildTeleporterDescriptor` comes from renderer-three, so the logic
  can't be imported by `apps/client` tests as it stands.
- **Bug: the old error stays while saving.**
  - A rejected Save shows the error and enables Save (L2357–2365).
  - The next Save's success path (L1441–1456) sets "Saving..." but never
    hides `tpFormError`.
  - The Model form's `save()` clears its error (`model-form.js` L301), so
    only this form has the bug. It was the edit-polish-2 review's nit.
- **Bug: a late world list is added to a newer list** (read from the code).
  - `openTeleporterForm` empties the select and starts
    `fetch('/api/worlds')`, whose `then` appends options. Nothing ties the
    answer to the opening that asked for it.
  - So closing the form and reopening it before the first answer arrives
    adds the first answer's worlds to the second list, giving each world
    twice. On a fast connection it is unlikely.
- **No committed test covers the form's state machine.** This was the
  edit-polish-2 review's should-fix: five `app.js` mutations there passed
  every test.
- **The pattern to copy is `createModelForm`** (`model-form.js`): a pure
  module with injected elements and dependencies and `onAnswer(seq, status,
  message)`, tested with fake elements (`tests/model-form.test.js`, 25
  tests).

### P4. A refused sky is logged on every change (item 4) — *probe*
`createSkyLoader.update` (`load-background.js` L210):
- **A value refused by rule** (`resolveSkyUrl` fails at L226) calls
  `clearAll()`, which forgets the last failure, and then `logFailure`, every
  time.
- **A fetched URL that failed** goes through the `failed` shortcut (L258).
  The shortcut re-reports the failure once (`shortcutLogged`) and then stays
  quiet.
- **Probe:** three `update`s with the document-relative `sky.jpg` give three
  `[sky] … (url-scheme) — sky.jpg` lines.
- **Effect:** every World Info change (a rename, a description) logs the
  refusal again for every viewer.

### P5. "Custom" for a catalog sky on another server (item 5) — *probe*
- **`storedUrl(path, worldBaseUrl, pageOrigin)`** (`library-catalog.js`
  L309) is the URL a pick stores:
  - the root path (`/assets/library/skies/…`) when the world is on the
    page's origin;
  - otherwise an absolute URL on the page's origin.
- **`skyValueFor`** (`sky-picker.js` L48) names a stored texture by
  comparing it **as a string** with `storedUrl(entry.url, …)` computed for
  **this** viewer.
- **Probe** (world on A):
  - an owner whose page is on A stores `/assets/library/skies/sky1-….jpg`;
    a viewer whose page is on B sees `__custom__`;
  - an owner on page B stores `https://b.example/assets/library/…`; a viewer
    on A sees `__custom__`.

  The sky itself shows correctly in both cases. Only the picker's label is
  wrong.
- **Catalog file names carry the first 12 hex digits of the file's sha256**
  (`<id>-<sha12>.<ext>`, checked by `loadCatalog`). Matching on that path is
  a strong **identification heuristic**, not a content guarantee: any host
  can serve other bytes at the same path (review 7).
- **`createSkyPicker.change(value)` doesn't compare `value` with the
  current one** (`sky-picker.js` L199; review 5). Today, re-choosing the
  shown option rarely sends, only because browsers fire no `change` for it.
  Once one id can stand for several stored URLs, the picker itself must
  refuse an unchanged pick.

### P6. The key-wiring guard's blind spots (item 6)
`tests/edit-key-wiring.test.js`:
- **`args` is only the text between `'keydown',` and the handler's `{`.** A
  capture flag after the body, as in `}, true)` or `}, { capture: true })`,
  is never read. The shipped listeners pass none.
- **Bodies are matched as raw text.** A consume call commented out next to a
  live copy elsewhere, or a call that exists only inside a comment, still
  satisfies "appears in order".
- `if (false) e.stopImmediatePropagation()` also passes. A text guard can't
  catch that, and the review accepted it as a limit (polish-2 L5).

### P7. The spawn hint (item 7)
- `nearSpawn(position)` (`teleport-trigger.js` L168) is true within
  `TELEPORT_TRIGGER_RADIUS + 0.5` of the origin in x and z. Today the
  destination form uses it once, for the position where the form opens
  (L1389).
- A pad later dragged onto spawn gets no note. That was accepted at
  polish-2 acceptance (§4.6 there): pads arm only after you step off them,
  so landing on one is harmless.
- **`refreshEditPanel` (L1855) doesn't run on a drag** (review 3,
  confirmed).
  - `onHandleChange` (L1720) and the numeric fields' commit (`commitVectorField`, L1930) refresh only
    the vectors.
  - The `som:set` handler refreshes the panel only when the changed node
    **is** the selection (L843), not one of its descendants.
  - So a note placed in `refreshEditPanel` would go stale during a drag, or
    when a child pad moves.
- **A selected group can hold a pad away from the group's origin.** "Is the
  group near spawn" isn't "is its pad near spawn". `world-position.js`
  already composes the parents' translation, rotation and scale.

### P8. Test baseline at `1206a52`
`apps/client` 766 and `packages/renderer-three` 265, all passing, on Node
v22.22.0. Commands: `node --test tests/*.test.js` in each package.

## 3. Decisions

### Settled (operator, before drafting)
- **S1 — Edit off closes every Edit-panel form** (item 2). This is what the
  earlier specs said; only the code is missing.
- **S2 — The HUD shows the document's current name** (item 1), with the
  same text rule as on load.

### Open (recommendations first)
- **L1 — Lane.**
  - **(a) Recommended: the full pipeline,** as polish-2: kickoff, GLM
    brief, brief gate, DeepSeek, GLM review, the release chain, Claude's
    browser checks, then your acceptance.
  - (b) The prototype lane.

  (a) went from kickoff to DEV in about 25 minutes last time, and item 3 is
  exactly the kind of change a review should read.
- **L2 — How the destination form becomes testable.**
  - **(a) Recommended: a module, `teleporter-form.js`, shaped like
    `createModelForm`,** with fake-element tests (Z3). `app.js` keeps only
    the DOM adapters and the wiring.
  - (b) Keep it in `app.js` and add more source-text guards.

  (a) is what the review asked for, and the Model form shows it works. (b)
  is what let five mutations through.
- **L3 — When a refused sky is logged.**
  - **(a) Recommended: once per refused value.** The same value refused
    again is quiet until a different value, `retry()` or a new world
    (`resetWorld()`). This
    matches the fetch-failure path's "not on every World Info change".
  - (b) Never log a rule refusal; show it only in the picker.

  (b) would undo r2 V2, which made every failure visible in visitors'
  consoles.
- **L4 — How the picker recognises a catalog sky.**
  - **(a) Recommended: by path.** The stored texture, resolved against the
    world's base, has no query or fragment and its path equals the entry's
    `url`, from any host.
  - (b) By path, but only on the world's origin or the page's origin.

  (a) is safe because the path names the image's hash (P5), and it covers an
  owner editing from a third server. A non-library host serving that exact
  path with other content would be labelled wrongly; the sky itself is
  unaffected.
- **L5 — The spawn hint (item 7).**
  - **(a) Recommended: a note in the Edit panel.** When the selected node is
    a teleporter, or holds one, whose pad is within `nearSpawn` of the
    origin, show "Near the spawn point: arriving visitors may land on this
    pad (it won't fire until they step off)". It updates with the panel.
  - (b) Leave it out, as accepted at polish-2.

  (a) costs one line of UI and a pure function. It doesn't block anything.
- **L6 — How far the key guard goes.**
  - **(a) Recommended: harden the text guard.**
    - Strip `//` and `/* */` comments from each listener's text before
      matching, with a scanner that respects string and template literals.
    - Read the full argument list up to the call's closing `)`, both before
      the body and after it.
  - (b) Move the listeners into a module and test them with fake events.

  (a) closes both blind spots in P6 without touching `app.js`. (b) is a
  larger refactor of the riskiest wiring for a small gain. `if (false)`
  stays a known limit.

## 4. The contract

### Z1. The HUD's world name (S2)
- **One function writes the HUD's world line:**
  `showWorldName(name)`, with the same text as today: `World: <name>` or
  `''`.
  - It's called from `world:loaded` with the event's `name`.
  - It's called from the `som:set` `__document__` branch with
    `client.som.extras?.atrium?.name`. It runs before the sky code and
    before the branch's `return`.
- No other line writes `hudWorldEl.textContent`.
- The console line on load is unchanged; a rename isn't logged.

### Z2. Edit off closes the panel's forms (S1)
- **`createFormGate` gets `closeCurrent()`:** it calls the current holder's
  closer, if there is one, and the gate ends up empty. Closers keep their
  "forget the wait only" rule.
- **`setEditMode(false)` calls `modelGate.closeCurrent()`** before it hides
  the panel. That covers the destination form, the Model form and the
  Library grid, whichever is open; the direct `closeTeleporterForm()` call
  there goes.
- **Edit off also discards the Model form's draft** (review 1).
  - `setEditMode(false)` calls `modelForm.reset()` after the gate. `reset()`
    clears `state.url`, the Check result and the pin, and forgets any wait.
  - The undo entry of a Save already sent is still recorded (Y7).
  - The destination form already starts empty on its next fresh opening,
    and the grid has no draft.
- **The Model form's input box always shows `state.url`:** `render()`
  writes `elements.url.value = state.url` unless the box has focus. Then
  every `reset()`, including the connection and world-reset paths (L753,
  L772, L2924), clears what's on screen too. That fixes P2's reconnect case.
- **`endEditSession()` doesn't change.** It calls `setEditMode(false)`
  first, so the gate and the reset now cover it, and its own two `close()`
  calls become harmless no-ops.
- **An add whose form no longer waits for it selects nothing** (review 2;
  P2):
  - **An answer a form owns:** the form handles it completely. An accepted
    one closes the form and selects the new node (`deps.selectNode`). The
    Model form already does this; the destination form does it now (Z3).
    `onStructureAnswer` returns.
  - **An answer for a `request.model` or `request.teleporter` add that the
    form no longer owns:**
    - an accepted one returns without selecting anything;
    - a rejected or unknown one shows the generic edit error ("Couldn't
      add: …"), with Edit on, and returns.

    The generic `selectAdded` branch is then reached only by palette and
    Duplicate adds, as J6 intended.
  - The undo entry is always recorded (Y7), owned or not.

### Z3. `teleporter-form.js` (L2)
- **The API:** `createTeleporterForm({ elements, deps, gate, name =
  'teleporter' })`, the same shape as `createModelForm`.
  - **Elements:** `form`, `worldSelect`, `destInput`, `spawnWarn`, `error`,
    `save` and `cancel`.
  - **Dependencies:**
    - `listWorlds()`, a promise of `[{ value, label }]`, or `null` for
      manual entry only;
    - `fillWorlds(options, { manualOnly })`, the DOM adapter that writes the
      select;
    - `isValidDestination`, `resolveDestination(dest)` and
      `teleporterName()`;
    - `buildDescriptor({ name, position, destination })`;
    - `addNode`, `structureBegin`, `undoRegisterAdd` and `refreshActions`;
    - `dispatchAllowed()`, meaning Edit is on and `!editDispatchBlocked()`;
    - `nearSpawn` and `clearEditError`.

  The module imports nothing from three.js or the DOM.
- **What it does,** with today's behaviour kept except the two fixes:
  - **`wire()`** (review 4) attaches the module's own handlers, as
    `createModelForm.wire()` does:
    - the select's `change`: a chosen world enables Save and hides the
      error;
    - the input's `input`: Save enabled exactly when the text is non-blank,
      and the error hidden;
    - Save's `click`, which calls `save()`;
    - Cancel's `click`, which calls `close()`.

    `app.js` adds no listeners to these elements.
  - **`open(position)`:**
    - refused while waiting on its own Save;
    - claims the gate;
    - **a fresh opening** first, synchronously, empties the fields, calls
      `fillWorlds([], { loading: true })` (or `{ manualOnly: true }` when
      `listWorlds` is null for this world), hides the error and disables
      Save; then it asks `listWorlds()`;
    - an opening while already open keeps what was typed and the list;
    - recomputes the spawn warning every time.
  - **The world list belongs to the opening that asked for it:** an answer
    that arrives after `close()`, or after a newer fresh opening, is
    dropped. *(Fixes P3's second bug.)*
  - **`save()`:**
    - refused unless `dispatchAllowed()` and not already waiting;
    - validates in today's order with today's messages;
    - names the pad, builds it and sends it with `structureBegin(seq, {
      name, descriptor, teleporter: true })` and `undoRegisterAdd`;
    - **then hides the old error** and shows "Saving...". *(Fixes P3's
      first bug.)*
    - A throw from `addNode` shows "Failed to place teleporter: …" and
      re-enables Save.
  - **`onAnswer(seq, status, message)`** works as `createModelForm`'s does
    (review 2). It returns `true` for every answer it was waiting on, and
    handles it completely:
    - **accepted:** closes the form and calls `deps.selectNode(name)`;
    - **rejected:** shows the error and enables Save again, keeping what was
      typed;
    - **unknown:** shows "The world did not answer; try again" and enables
      Save.

    Any other seq returns `false` and changes nothing. Z2 says what
    `app.js` does then.
  - **`close()` and `reset()`** forget the wait only. `isOpen()` and
    `waitSeq` are read-only views.
- **What stays in `app.js`:**
  - the Teleporter button's position (`palettePlacement`);
  - the two DOM adapters;
  - the gate registration;
  - `onStructureAnswer`'s `request.teleporter` branch: it calls
    `teleporterForm.onAnswer` and then follows Z2's owned and not-owned
    rules;
  - Escape's "ignored while saving", which now reads `teleporterForm.waitSeq`.

  `formWaitSeq`, `pendingPosition` and `closeTeleporterForm` go.
- **The ids, markup and wording in `index.html` don't change.**

### Z4. A refused sky is logged once (L3)
In `createSkyLoader`:
- **A rule refusal records `refused = { value, reason }`** and logs only if
  `value` differs from the recorded one.
- **These clear the record:**
  - an accepted value, which includes `''` and "no sky";
  - `retry()`;
  - `resetWorld()`.
- A refusal still clears the slots and returns `{ ok: false, reason,
  message }` every time.
- The fetch-failure path, its shortcut and its logging don't change.

### Z5. Catalog skies recognised by path (L4)
- **`skyValueFor(texture, skies, { worldBaseUrl, pageOrigin })`** returns
  an entry's `id` when `new URL(texture, worldBaseUrl ?? pageOrigin)` parses,
  has no search or hash, and its `pathname` equals the entry's `url`.
  Otherwise it returns `SKY_CUSTOM`, and `''` or missing stays None.
- **What a pick stores doesn't change** (`storedUrl`).
- **`change(value)` returns `null` and sends nothing when `value` equals
  the picker's current value for the SOM** (`valueForSom()`; review 5). It
  does so before computing any URL, so a catalog sky stored under another
  origin is never rewritten just by being chosen again.
- **The match is a path heuristic, not a content check** (review 7). A
  wrong label is possible for a non-library host that serves that exact
  path; the sky itself is unaffected.

### Z6. The key guard (L6)
`tests/edit-key-wiring.test.js`:
- **A small scanner** in the test strips comments outside string, template
  and regex literals before any match. Regexes are only those that follow
  `(`, `,`, `=` or `return`. The scanner has its own tests.
- **The third argument is found exactly** (review 6). The scanner splits
  `addEventListener(`'s arguments at **top-level** commas, matching
  `()`, `[]` and `{}` and skipping strings, templates and comments.
  - There is a capture flag if a third argument exists and is `true`, or is
    an object literal with a `capture` property that isn't `false`.
  - Any other third argument (a variable, a call) fails the rule as
    "unknown options".
  - The handler's body is never searched for these words.
- The existing seven rules stay as they are and run on the stripped text.

### Z7. The spawn note (L5 (a))
- **A pure `padNearSpawn(node, worldPositionOf)`** in `teleport-trigger.js`
  (review 3).
  - It walks the node and its descendants. For **each** node that
    `isTeleporter`, it calls `worldPositionOf(thatNode)` and tests
    `nearSpawn` on the result. It's true if any pad is near.
  - `app.js` passes the existing `world-position.js` function, which
    composes the parents' translation, rotation and scale.
  - The tests pass a fake that reads plain values.
- **`#ep-spawn-note`** sits in the selection fields, hidden by default.
- **One function, `refreshSpawnNote()`,** reads the current selection and
  sets the note. It's called on:
  - every selection change;
  - every handle change (`onHandleChange`), live during a drag;
  - every numeric transform commit (`commitVectorField`);
  - undo and redo of a transform;
  - `som:set` of a transform on the selection **or any of its
    descendants**;
  - `som:add` and `som:remove` under the selection.
- The note is only shown. The trigger and the form's own warning don't
  change.

### Z8. What does not change
- The server, the protocol, the SOM and `packages/client`.
- `teleport-trigger.js`'s trigger rules.
- The sky controller's generation rules (R1–R7).
- What the picker stores.
- The grid's logic.
- The Model form's logic, except two things: its input mirrors `state.url`
  (Z2), and an add it no longer owns is no longer selected.
- `index.html`, except Z7's one element.
- The palette's and Duplicate's selection of an accepted add (J6).

## 5. Tests

| Item | New or changed tests | Proof of failure |
|---|---|---|
| Z1 | A guard in `apps/client/tests/app-wiring.test.js` (new) reads `app.js`: one write to `hudWorldEl.textContent`, inside `showWorldName`; the `world:loaded` handler and the `__document__` branch both call it, the latter before its `return` | (a) drop the call from the `__document__` branch |
| Z2 | `model-form` (gate): `closeCurrent()` calls only the holder's closer, once, and empties the gate; with no holder it's a no-op. `model-form` (form): **type and Check a URL, close, `reset()`, reopen: the state and the input box are both empty**; a reset while saving forgets only the wait; render leaves a focused box alone. The same guard file: `setEditMode`'s off branch calls `modelGate.closeCurrent()` then `modelForm.reset()`; the `request.model` and `request.teleporter` branches of `onStructureAnswer` return without `selectAdded` for an answer the form doesn't own | (b) remove `closeCurrent()` from the off branch; (b2) `closeCurrent` that forgets to empty the gate; (b3) render not writing the input box; (b4) let a not-owned accepted model add fall through to `selectAdded` |
| Z3 | `teleporter-form.test.js` (new), with a fake-element harness as `model-form.test.js`. It covers: `wire()` (choosing a listed world enables Save; typing a destination enables it, blank disables it; either hides an error; changing inputs after a rejection); open (fresh: fields emptied and the list in its loading or manual-only state **before** `listWorlds()` resolves; reopen keeps what was typed); refused while waiting; validation messages; a Save that sends once with `teleporter: true` and registers undo; a double Save sending one request; accepted (closes and selects), rejected and unknown answers; an answer for another seq returns `false` and changes nothing; **an error hidden on the next Save**; **a late world list after a close, and after a newer opening, dropped**; close while waiting forgets only the wait; reset; the gate. **Accepted after close:** with Edit off, and with Edit back on and another node selected, nothing is selected (through the module's `false` and the guard on `app.js`'s branch) | (c) Save not hiding the error; (c2) the world list not tied to its opening; (c3) a rejection that doesn't re-enable Save; (c4) an accepted answer for a closed form selecting the node |
| Z4 | renderer-three `load-background`: the same refused value three times logs once; a different refused value logs; after an accepted value, or `retry()`, or `resetWorld()`, the first value logs again; each call still returns the refusal | (d) log every refusal |
| Z5 | `sky-picker`: the root path, `https://a.example/<path>` and `https://b.example/<path>` all give the entry's id from either page origin; a query, a fragment, a different path or a near-miss name give Custom; None as before. **The SOM holds a catalog path from origin A, the picker runs on origin B, and `change(currentId)` makes zero `applyExtras` calls** | (e) restore the string comparison; (e2) drop the unchanged-value check |
| Z6 | `edit-key-wiring`: scanner tests (`//` inside a string or URL kept, comments stripped, template literals kept); the top-level argument splitter (nested parentheses, object literals, strings with commas); and the guard run against crafted sources: a `}, true)` capture after the body, `{ capture: true }`, an unknown third argument, and a consume call only in a comment, each failing the named rule; **and passing cases: a handler whose body contains `true` and a variable named `capture`, with no third argument, and `{ capture: false }`** | (f) a capture flag added after the real Edit-mode listener's body; (f2) its `stopImmediatePropagation()` commented out |
| Z7 | `teleport-trigger`: `padNearSpawn` for a pad on spawn, just outside it, a node with none, **an offset child pad in a translated and rotated group (near when the group's origin is not, and the reverse)**, and `worldPositionOf` called once per pad. The guard file: `refreshSpawnNote()` is called from `onHandleChange`, `commitVectorField`, the selection change, and the `som:set` handler for descendants | (g) ignore children; (g2) test the group's own position instead of each pad's; (g3) drop the call from `onHandleChange` |

**Expected counts:** `apps/client` 766 + new; renderer-three 265 + new; the
rest unchanged. The handoff gives each exact number next to its command.

**Proofs:** commit first; break the file, run, record the failing test
names, restore the file **from a saved copy, never with `git checkout`**,
re-run green. "Not reproducible" is not an acceptable result.

### 5.1 Claude's browser checks (after publish, before DEV acceptance)
These use the local harness (library-sky passdown §5.3), with a fresh server
for each run:
1. Rename the world's document from a second session: the HUD changes
   without a reconnect; clear the name and the line goes empty.
2. With the Model form open and a URL typed and checked, turn Edit off and
   on: the form is closed and empty. The same for the Library grid and the
   destination form.
3. A stubbed rejection of a pad: the error shows, and on the next Save it's
   gone while "Saving...". Accept it: the form closes and the pad is
   selected.
4. Open, close and reopen the destination form with a delayed `/api/worlds`:
   each world appears once.
5. A refused sky value, then three World Info renames: one `[sky]` line.
6. A catalog sky stored as the root path, viewed from a page on a second
   origin: the picker names it.
7. Drag a pad onto spawn: the note shows **during** the drag; drag it off:
   it hides. The same with a group whose child pad is offset from the
   group's origin.
8. **Accepted after close:** a stubbed slow answer to a pad's Save; Edit off,
   Edit on, select a cube; the answer arrives: the cube stays selected, and
   Undo removes the pad. The same with a model's Save.
9. **Model form draft:** type and Check a URL; Edit off and on; reopen Model:
   the box is empty. Reconnect with a URL typed: the box is empty.
10. Regression: the key wiring as in polish-2 §5.1 (Ctrl+D, Delete in a text
   field) and the library-sky checks 1–14.

## 6. DEV acceptance (operator, Firefox, hard reload, owner)
Marker: `!!document.getElementById('ep-spawn-note')` is `true`. Under L5 (b),
the marker is in the handoff instead.
1. **Rename:** rename the world in the SOM Inspector's World Info while the
   client is open: the HUD changes at once.
2. **Edit off:** open the Library, turn Edit off, then on: the grid is
   closed. The same for Add Model and Teleporter.
3. **Teleporter form:** Save with a bad destination, fix it and Save: the
   old error is gone while saving; the pad appears.
4. **Sky:** the picker still names the current sky; pick another; Retry and
   failures as before.
5. **Spawn note:** select a pad near spawn: the note shows.

## 7. Worker rules and release path
As library-sky (`devtasks/KICKOFF-library-sky.md`), with this round's
specifics:
- **Steps, one commit each:**
  1. Z4 (renderer-three);
  2. Z5 (`sky-picker.js`);
  3. Z3 (`teleporter-form.js` and its tests);
  4. the `app.js` wiring for Z1, Z2 and Z3, plus Z7's element and note, and
     `app-wiring.test.js`;
  5. Z6;
  6. full suites, proofs (a)–(g) with their sub-proofs ((b2)–(b4), (c2)–(c4), (e2), (f2), (g2), (g3)), and the handoff.
- **`--max-runtime 3h`** at creation.
- **Kickoff:** the front door verifies this file's hash and posts it on the
  kickoff. The kickoff only copies it, because it has only `kanban_*` tools
  (library-sky passdown §4.3).
- **Front door:** after each create, read the card back. If the body is
  missing, post it as the first comment on that card and never create a
  second one (§4.2 there).
- **DEV deploy and finalizer:** if the handoff is truncated, the operator
  verifies from the host (library-sky passdown §5.2).

## 8. Notes for the brief author
- **Copy `createModelForm`'s shape for Z3,** down to `onAnswer`'s return
  value and `wire()`. The form selects its own accepted pad. Its
  `onStructureAnswer` branch never falls through to `selectAdded` (Z2): that
  generic branch is only for palette and Duplicate adds now.
- **The biggest risk in this round is changing form lifecycles while moving
  code** (review). Test every transition the table names before wiring
  `app.js`.
- **`buildTeleporterDescriptor` stays a dependency** (it's from
  renderer-three, which `apps/client` tests can't import).
- **Z2's gate call replaces the direct `closeTeleporterForm()` in
  `setEditMode`.** Don't add separate `modelForm.close()` and
  `libraryGrid.close()` calls: the gate already knows which one is open.
- **Z6's scanner is test code only.** It doesn't need to parse JavaScript,
  only to tell comments from string, template and regex literals well enough
  for `app.js`. Its tests pin that.

## 9. Recorded, not in this round
1. **The SOM Inspector's models, the §9.5 race, L31 lighting, a raw send
   that's refused, and the identity-replace case** stay as the library-sky
   passdown §6.2 lists them.
2. **The world list's name doesn't follow a rename.**
   - `/api/worlds` serves the `worlds.name` column. It's set at creation
     (`world-store.js` L57) or by `PUT /api/worlds/:id` with `name`
     (`http-routes.js` L758).
   - A rename through the document's `extras.atrium.name` (World Info)
     changes only the document, so the world browser and the destination
     form's list keep the old name. Autosave doesn't touch the column.
   - Fixing that is a server change, so it's left to a later server round.
     One option: autosave copies a changed `extras.atrium.name` into the
     column.

## 10. Where this sits
1. Library-sky (`a31c5a62`, released 2026-10-22).
2. **This round.**
3. Next: step 4 (scripting, with model animations), whose pre-brief is being
   drafted alongside this one.

## 11. Review log
- **Rev 0** (2026-10-22 evening, `6072ff2`): drafted from code reading and
  probes at `1206a52`, with L1–L6 open.
- **Rev 1** (2026-10-22, ~21:45 PT): an outside review of Rev 0 (read-only,
  against `1206a52`). Claude checked each finding in the code; all are
  confirmed and taken.

| # | Finding | Severity | Where it went |
|---|---|---|---|
| 1 | Edit off keeps the Model form's typed URL | Must-fix | P2, Z2 (`reset()` on Edit off; the input mirrors `state.url`), tests (b3), §5.1 check 9. **Wider than reported:** even `reset()` never cleared the visible box |
| 2 | An accepted add whose form has closed still selects the node | Must-fix | P2, Z2 (owned versus not-owned), Z3's `onAnswer`, tests (b4) and (c4), §5.1 check 8. **Wider than reported:** the Model form has the same fall-through |
| 3 | The spawn note isn't refreshed during a drag, and a group's position isn't its pad's | Must-fix (under L5 (a)) | P7, Z7 (`worldPositionOf` per pad; `refreshSpawnNote()` call sites), tests (g2) and (g3) |
| 4 | The form's input handlers belong to the module | Should-fix | Z3 `wire()` and the fresh-open order; tests |
| 5 | The picker doesn't refuse an unchanged pick | Should-fix | P5, Z5, test (e2) |
| 6 | Searching all argument text for `true`/`capture` would reject valid listeners | Should-fix | Z6 (exact third argument), passing-case tests |
| 7 | A hash in a path isn't a content guarantee | Nit | P5, Z5 wording |

The reviewer recommends (a) for all of L1–L6, the same as this document.
