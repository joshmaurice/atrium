# Passdown 2026-11-08: `subtree-add` shipped to PROD (`45e6cd00`)

This supersedes `Atrium-Passdown-2026-11-06-copy-objects-shipped.md` as the
starting point. Read this file first. The host, connector and convention notes,
lessons and cheap-round recipe of `Atrium-Passdown-2026-11-06-richer-add-shipped.md`
(§3, §4) and the copy-objects passdown's lessons (§3) still hold; this file
adds to them.

**First instruction for the next session's Claude:**
1. Clone the repo (`add_repo` `joshmaurice/atrium` with access `push`, clone to
   `/home/claude/atrium`) and read this file.
2. **The next round is selection** (SA-L6 (d): a click selects the top group,
   repeated clicks drill down, Alt goes to the leaf, a breadcrumb) **with
   parts** (SA-L7 (c), T11: Copy, Duplicate and Undo of a part). Its contract
   so far is §9 of `devtasks/PREBRIEF-subtree-add.md`. It needs its own
   pre-brief first, and that pre-brief's **first item** is splitting
   `message-depth-measure.test.js` (§5 item 1).
3. **Use the `atrium-ops` connector** for board, release, log and git state.
   It is read-only. Check DEV's actual SHA with `release_status` before
   reading an acceptance as done.
4. The release rule, cost rule, host-command rule (no leading spaces, real
   paths) and the review-SHA rule are unchanged.

## 1. Where things stand
| | |
|---|---|
| PROD, MAIN, DEV | **`45e6cd0015e6a2f205030376f33fdd903f26e04b`**, state `COMPLETE` (2026-11-08, 08:17 PT; PROD's backup `atrium-20261108T161727Z-42aa56ffac68.db`). PROD serves the same `app.js` as DEV (`d7151c35be74`) |
| The round | `subtree-add`: one `add` carries a node and its children (256 nodes, 8 generations, 1,024 primitives, the 1 MiB message), with materials shared inside the message as `{ ref: n }`. A top-level group can be duplicated, deleted without a question, undone and redone, and copied between worlds. Clients and servers declare `addFields` 3 |
| The contract | `devtasks/PREBRIEF-subtree-add.md` FINAL Rev 2, **Rev 2.1** (one DEV step after the outside review, and two steps' wording after the DEV run) |
| The record | `devtasks/HANDOFF-subtree-add.md`: commits, tests, first-fail evidence, the proofs (§2.1), departures (§4), the fresh check (§7), the outside review (§8), the release and the pre-DEV checks (§9) |
| Reviews | the fresh-agent code check (no must-fix; S-1, S-2 and three nits taken). **Fable**, `devtasks/REVIEW-subtree-add-code-fable.md`: **APPROVE WITH NITS** of `02b5554b`. It **cloned and ran** the tests and its own probes, and found the round's one real bug (S-1, taken with N-2) |
| Tests | 65 suites, **4,463 passing, 0 failing, 1 named skip** (`apps/client`'s richer-add R7 stated-limit test); 4,234 at `99ed7a8` |
| The DEV acceptance | §5 steps 1–6 passed on `45e6cd00` (two of them after correcting their words, §3 item 3). **Step 7 (PROD): passed** (a group duplicated, the copy deleted without a question, Undo) |

### 1.1 Facts found this round
- **PROD's `p6` at `45e6cd00`** is unchanged from the pre-brief's §2.5:
  - 24 worlds, 460 top-level objects (450 copy today, 9 have children, 1 has
    a non-unit rotation);
  - **9 groups**, each of 3 nodes at depth 1; the largest is 16,656 bytes as
    one message, all 9 together 149,039;
  - **1 part carries the hidden marker** (the case S-1 fixed);
  - 5 objects carry a credit (pastes since `42aa56ff`);
  - 2 behaviours with a foreign reference.
- **The host's pnpm is 11.8.0** (the survey's install); the cloud session's
  is 10.28.0.
- **`pnpm rebuild better-sqlite3` builds nothing** after an
  `--ignore-scripts` install: pnpm skips the script and exits 0. The
  package's own install script does it; now in AGENTS.md's gotchas.
- **A failing `assert.equal` on two glTF-Transform objects kills the test
  run** (out of memory, inspecting the document graph) instead of failing.
  Now in AGENTS.md's gotchas.
- **Edit mode selects hidden objects on purpose** (F-L8, 4b-2): a click
  where a hidden part is selects it, with its outline.

## 2. What the round changed (for the next pre-brief's author)
- **`add` carries `children`** (`definitions.node`, recursive, in both add
  schemas) and a primitive's material may be `{ ref: n }`. Refs point
  backwards only: inline materials are numbered from 0 in depth-first
  pre-order, and a primitive with no material takes no number.
- **The tree rule's two copies** are in `packages/client/src/add-spec.js` and
  `packages/server/src/send-policy.js`, sharing `tests/fixtures/add-node-vectors.json`.
  The rule: `subtreeShapeProblem`, `membersInMessageOrder`,
  `materialRefsProblem`, `nodeNameFormOk`. The server also has step 0,
  `subtreeCountProblem`, which runs before Ajv and reads only lengths.
- **The server checks every member** as it checked the one node: S2's
  `source`, names, ids against one `savedObjectIds()` set, transforms, extras,
  model hosts, the behaviour caps. `world.addNode` checks every name
  (`treeNameTaken`).
- **`ingestNode` is atomic:** a first pass checks the refs and every
  primitive before anything is created, then the build uses one buffer per
  message.
- **The hello carries `capabilities.addFields`:** the client sends 3, the
  server sends `ADD_FIELDS_LEVEL` 3 and refuses edits from a tab below it.
  The client keeps the server's level as `client.serverAddFields`;
  `treesAllowed()` in `app.js` gates every tree path.
- **Events:** `som:add` fires once per member, with `{ nodeName, root }`;
  `som:remove` carries `removed[]`. Anything listening to `som:add` that
  walks the world should act on the root's event only, as the re-capture
  does.
- **`app.js` hides a node that arrives hidden** in a live add (S-1), retrying
  for at most 10 frames; `applyVisibility` still runs only at view creation.
- **Undo** captures a whole tree (every part addressable), re-points part
  handles by name, and re-captures on `som:add` (once per message) and
  `som:remove`.
- **`copy-paste.js`** copies a group whole and pastes it member by member
  (names, ids, extras, credit, K7, K8). It refuses a group for a server below
  level 3, and inlines a single object's refs for one. `partsText` and
  `descriptorPartsSummary` give "2 parts; includes 1 hidden part".
- **The e2e harness's `wireUndo(client, { recaptures: true })`** wires
  `app.js`'s re-captures.

## 3. Lessons
1. **A test that runs a step the page never runs passes for the wrong
   reason.** The render test called `applyVisibility` itself, which the page
   runs only at load, so a hidden part arriving live was drawn in every open
   tab and the test stayed green. Fable found it by running the real ingest
   without that call. When a test needs a page step, lift the page's own
   handler and run it, as the pad and hidden-part wiring tests now do.
2. **The reviewer that can execute finds the bugs.** ChatGPT couldn't clone
   again; Fable cloned, ran every listed file, built its own probes on the
   two harnesses, and found S-1. The prompt's STEP 2 is now runnable as
   written (§1.1, `better-sqlite3`). Prefer Fable for code reviews.
3. **An acceptance step must say where to look and what is meant to
   happen.** Two DEV steps read as failures and were the steps' words: a
   disabled button's reason is its tooltip, and Edit mode selects hidden
   objects on purpose (F-L8). Check each step against the decisions already
   in force, and name the control and the gesture, as the copy-objects lesson
   said for panels.
4. **Advice gets tried before it is given.** I recommended
   `pnpm rebuild better-sqlite3` without running it; on a fresh clone it
   builds nothing. Caught before it reached AGENTS.md.
5. **A proof that doesn't fail can mean two layers, or a missing test.**
   (p1d) passed on the server because step 0 enforces the same budget, so a
   second break proved both. (p3)'s `apps/client` half passed because the
   test didn't exist yet. Read every unexpected pass before moving on.
6. **Probes from a design-time check are written against sketches.** The
   pre-brief's T12 probes used a stand-in builder and their own
   `hasSharedMaterial`. Port them to the real code before calling acceptance
   done (now in `devtasks/spike-subtree-add/`).

## 4. Release notes
- No `package.json` or lockfile change; no stored data to migrate.
- Version skew: a tab from before the deploy is refused edits and told to
  reload (R6, at level 3). A level-3 page facing an older server keeps single
  objects, inlining any refs, and refuses groups.
- A rollback to `42aa56ff`: saved groups are ordinary glTF nodes with
  children and load as before. Their shared materials are saved shared, as
  glTF allows. The old code refuses only new `add`s that carry children.
- The DEV gate merged nothing: DEV, MAIN and PROD are the branch tip exactly
  (MAIN fast-forwarded `70a30bd..45e6cd0`).

## 5. Follow-ups
1. **Next: selection and parts** (§9 of the pre-brief: SA-L6 (d), T11, and
   the (p9) proof). Its first item: **split `message-depth-measure.test.js`**,
   which took 134.6 s of its 180 s limit in this round's full run.
2. **From this round:**
   - the SOM inspector's tree view rebuilds once per member on a tree's
     `som:add` (`tools/som-inspector/src/app.js` L301); unmeasured, outside
     this round's files;
   - a group over 1,000,000 bytes can't be restored by Undo (the client's
     margin), so its Delete asks first (N3's rule; none on PROD, the largest
     is 16,656);
   - kept nits:
     - Undo re-points parts by name, not by child-index path;
     - the K7 note's wording ("Its part “X”’s behaviour referred…");
     - the paste notes name a part by its pasted name (N-3);
     - the T2-order test's `children-names` variant;
     - the S6 test's shadowed-name variant.
3. **Carried from the copy-objects passdown §5:**
   - a rebinding UI for `copiedFrom.refs`;
   - several objects at once, and a clipboard that survives a reload;
   - the client's animation check in `atriumProblem`;
   - healing a malformed saved credit;
   - text-direction characters in names;
   - a ref's `name` over 64 characters;
   - Inspect at `world:loaded`;
   - and its carried list: `richer-add`'s N1 and N2, the audit items,
     `initDocumentView`'s argument, PROD's non-unit rotation, the hidden host
     tab, choppy behaviour objects, `add-check`'s test nits, the registry race
     at teardown, "Custom graph", 4d-1's three items, `c2.py`'s flake, and the
     kickoff template.

## 6. Cleanup (operator, on the host)
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/subtree-add
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete release/2f28f030ec72 release/3cfeeed9a8bf release/4f66f93b7f8b release/769825ce3781 release/85669db0f8a9 release/a096cf3f8fcf release/e536913011cc release/fe4dcbb34ed7
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete workflow/undo-hold workflow/scripting-4d-1
```
These are every branch on GitHub but `main` (checked 2026-11-08). The first
line goes only after this passdown is on `main`.
