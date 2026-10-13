# Pre-brief: Create starts new worlds from a fixed template, not the live commons (step 0b)

Status: **FINAL, Revision 0 (2026-10-12).**
- **Decision:** option B, chosen by the operator on 2026-10-12 (from the
  2026-10-09 passdown §4: "Stop copying the commons; start from a fixed
  template, as home worlds do").
- **Decisions C1–C5 (§3)** were confirmed by the operator on 2026-10-12, as
  were the proposed answers to §5's open questions.
- **What new worlds look like:** the operator chose the home-world template
  (a `Ground` node with no mesh, so a new world looks like a fresh home
  world). The considered alternative was a starter showing the commons'
  original visible ground plane without the crate and lamp.
- **Priority:** before Phase 3 step 1, because Edit mode on the commons
  would spread every commons edit into every world created afterwards
  (`docs/DESIGN-phase3-placement-scripting.md` §9, step 0b).

**Inputs:**
- `devtasks/Atrium-Passdown-2026-10-09-domain-ewwb-commons-owner.md` §4 (the
  finding and the options);
- `devtasks/Atrium-Passdown-2026-10-12-source-ref-guard.md` (the latest
  passdown, and the pre-kickoff checks in its §7.2);
- `devtasks/Atrium-Passdown-2026-10-03-step9-cleanup.md` §5 (process
  lessons).

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Verified at:** `main` `be41b6019bf4e1fe58f43a6cd1dda947d647f062`. Its
  runtime code is identical to the released `525df00d`; later commits only
  rename or add docs.
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff,
  supplied from the host, never a SHA quoted here.

**Prototype:** Claude built and tested the whole change in the chat sandbox
(§6.3). The patch stays with the operator as a reference and isn't given to
the agents.

## 1. The problem

`POST /api/worlds` (Create) builds the new world's first document from the
**live world**, serialized with only avatar nodes excluded:
- the code is in `packages/server/src/http-routes.js` ~L596–609:
  `getLiveWorld().serialize({ excludeNodes: getLiveAvatarNodeNames() })`;
- in registry mode the live world is the default host's world, which is
  **the commons**.

**Every commons edit therefore becomes starting content of every world
created afterwards.**
- **Observed on PROD** (2026-10-09): a teleporter placed in the commons
  appeared in newly created worlds.
- **It surfaced only then** because the PROD commons was read-only until its
  owner was set on 2026-10-09.
- **It will get much worse with Phase 3:** Edit mode makes commons edits
  routine.

**Not affected:**
- **Home worlds:** they're seeded from `DEFAULT_HOME_DOCUMENT`
  (`home-world.js` ~L13).
- **Existing worlds:** the copy is taken once, at creation.

## 2. Verified facts

- **`DEFAULT_HOME_DOCUMENT`** (`home-world.js` ~L13) is a minimal valid glTF:
  - one `Ground` node in the scene;
  - root `extras.atrium` with `name: 'Home'` and `navigation` (walk and
    fly, speed, terrain following);
  - `asset.generator: 'Atrium Home World'`.
- **The client shows the root `extras.atrium.name` as "World: <name>"**
  (`apps/client/src/app.js` ~L613). A created world that reused the home
  template unchanged would display as "World: Home".
- **The client's Create sends `{ slug, name }`** (`app.js` ~L1519).
- **`getLiveWorld()` (~L128) and `getLiveAvatarNodeNames()` (~L164)** are
  used only by Create. They become unused after this change.
- **The original reason for copying** (the code comment) was that a created
  world must be valid glTF from the moment it exists. A fixed template meets
  that too.
- **One existing test depends on the old behaviour, by name only:**
  `world-crud.test.js` ~L214, "POST /api/worlds creates a world with the
  live world as initial document". It asserts only the response fields,
  not the document.

## 3. Decisions (C1–C5)

- **C1. Create uses a fixed template.**
  - **New export in `home-world.js`:** `newWorldDocument(name)`. It returns
    the same content as `DEFAULT_HOME_DOCUMENT`, with
    `asset.generator = 'Atrium World'` and
    `extras.atrium.name = name`, as a JSON string.
  - **The name is** the request's `name` trimmed if non-empty, otherwise the
    trimmed `slug`.
  - **`POST /api/worlds` calls it** instead of serializing the live world.
    It no longer reads the live world at all.
- **C2. Home worlds are unchanged.** `DEFAULT_HOME_DOCUMENT` stays byte for
  byte as it is.
- **C3. `getLiveWorld()` and `getLiveAvatarNodeNames()` are removed** from
  `http-routes.js`, since nothing else calls them. The `world`, `sessionsRef`
  and `defaultHostRef` options stay accepted, so existing callers and tests
  are unaffected.
- **C4. No migration.** Existing worlds keep whatever they inherited. The
  workaround from the 2026-10-09 passdown still applies: the owner deletes
  the inherited pad.
- **C5. Server only.** No client, protocol or schema change.

## 4. Out of scope

- A "duplicate this world" or "start from a copy of the commons" feature.
  That would be a separate, deliberate feature.
- Choosing a template per world, or a template gallery.
- Cleaning inherited content out of worlds that already exist.

## 5. Open questions for the brief author / critic

1. **Should `newWorldDocument` live in `home-world.js` or a new module?** The
   proposal is `home-world.js`, next to the template it derives from.
2. **Should a non-string `name` be rejected?** The proposal is no: a
   non-string or blank `name` falls back to the slug, matching today's
   tolerance. The `worlds.name` column keeps whatever the existing route
   already stores.

## 6. Test expectations

### 6.1 `packages/server/test/world-crud.test.js`

- **Rename** the ~L214 test to "POST /api/worlds creates a world". Its
  assertions are unchanged.
- **New: the template, not the live world.**
  1. Add a node `commons-only-pad` to the live `world` used by this file's
     handler.
  2. Create a world named "Template World", then `GET /api/worlds/:id`.
  3. Assert:
     - the node names are exactly `['Ground']`;
     - `commons-only-pad` appears nowhere in the document;
     - `extras.atrium.name === 'Template World'`;
     - `asset.generator === 'Atrium World'`.
  4. Remove the added node in `finally`.
- **New: name falls back to the slug.** Create with no `name` → the
  document's `extras.atrium.name` equals the slug.
- **New: the document loads.** Load the created row's document with
  `createWorldFromDocument` → `getNode('Ground')` exists and `meta.name`
  equals the given name.

### 6.2 Existing suites

All server files, each run on its own, must pass and exit on their own.
`packages/client` (140) and `apps/client` (191) must pass, with 0 skipped.
Report `node --version` and the skipped count.

### 6.3 Proof of failure

| Proof | Break | Expected failures (prototype result) |
|---|---|---|
| (a) | `http-routes.js` restored to `origin/main` | all three new tests; the file exits on its own (~5 s) |

**Prototype results** (sandbox, Node 22.22.0):
- `world-crud.test.js`: 75 pass (72 before), 0 skipped, about 5 s;
- all 18 server files pass and exit on their own, 336 tests in total;
- `packages/client`: 140 pass, 0 skipped;
- proof (a): failed exactly the three new tests.
- **Correction:** the 2026-10-12 passdown records 330 server tests at
  `525df00d`. The per-file counts in that same report add up to 333; 336 is
  333 plus the 3 new tests.

## 7. Operator checks

- **Before kickoff** (2026-10-12 passdown §7.2):
  - no open sentinel (`t_29acdd40` from the last round was still `todo`);
  - a push dry run;
  - the base SHA from a host fetch.
- **DEV acceptance (`https://dev.ewwb.dev`):**
  1. While signed in, place or move something in the DEV commons, if DEV
     has a commons owner (unconfirmed; 2026-10-09 passdown).
  2. Create a new world from My Worlds and load it.
  3. **Pass:** it shows only the ground, nothing from the commons, and the
     HUD reads "World: <the name you typed>".
  - **If DEV has no commons owner,** step 3 alone still confirms the
    template and the name.
