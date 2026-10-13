# Atrium Passdown — 2026-10-13 (morning) — Phase 3 step 1a (edit plumbing), label-tracking fast lane

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-13-teleport-rearm.md`
(earlier the same day). Its §6 follow-ups still hold, except where this file
says otherwise.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read every
passdown newer than the one you think is latest.

**Read §3.6 before the next pipeline round.** A section added to the
worker-card requirements today made a worker believe it had no terminal. It
was fixed at ~10:05 PT; §3.6 says how, and how to check it's still fixed.

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (2026-10-13 ~09:50 PT) |
| DEV / MAIN / PROD | all at `a40d01a93eab9264a039fe40c63ff068cea543f9` |
| Releases today in this session | `2dc3a196ecfd4bc58afd30882200eca305dd3cd6` (step 1a, PROD ~08:10 PT), then `a40d01a9` (label tracking, fast lane, on top) |
| Pre-brief | `devtasks/PREBRIEF-edit-mode.md`, FINAL Revision 2, uploaded as `0456c0c` |
| Branches | `workflow/edit-plumbing` (published by the pipeline; kept like the other `workflow/*`). `claude/label-tracking`: **the operator deletes it** (the session can't). `review/edit-plumbing-r1`: deleted |

**Board, step 1a (`edit-plumbing`):**
- `t_bc5d26ff` kickoff — done (after an operator release, §3.1)
- `t_82b23365` GLM brief — done
- `t_d2207154` brief-review gate — completed by the operator after the correction (§3.2)
- `t_dbf124e2` DeepSeek implementation (`a93b2ff`) — done
- `t_6c056329` GLM review — done; `t_6af76484` review gate — done
- Revision round (one DeepSeek revision, one GLM re-review) produced `2dc3a19`; card IDs not captured here
- `t_ec9fd202` DEV gate for `a93b2ff` — closed as superseded
- `t_05c630f4` DEV gate for `2dc3a196` — accepted, closed
- `t_754ea34c` PROD gate, `t_f942a852` PROD deploy (run 691) — done
- `t_052800b3` sentinel — done, **but early** (§3.4)

**Board, label tracking (fast lane):**
- `t_46559fd8` GLM review — `triage`, superseded (§3.6). Can't be completed from `triage`; a comment explains it.
- `t_791ee2d5` GLM review r2 — done, **APPROVE** (run 694)
- PROD gate and deploy for `a40d01a9` — done; IDs not captured. The host state confirms `COMPLETE`.

## 2. What shipped

### 2.1 Phase 3 step 1a — edit plumbing (`2dc3a196`)

Server, protocol, SOM and client-library groundwork for Edit mode. **No new
UI** beyond the inspector's refusal display and two small rename handlers.
The contract is `PREBRIEF-edit-mode.md` §5, A1–A10:

- **A1 `hello.canEdit`.** Same computation as `canPlaceTeleporters`, which
  stays as an alias for one release.
- **A2 `requestSeq` and `session` on request-caused `set`/`add`/`remove`
  broadcasts.** `add` and `remove` schemas are now direction-specific
  (`add:client`/`add:server`, `remove:client`/`remove:server`). A client can't
  send `requestSeq`. The disconnect `remove {id}` now validates.
- **A3 client edit tracking.** One counter for every outgoing message.
  Pending edits live on the connection record and resolve as `edit:accepted`,
  `edit:rejected` or `edit:unknown` (including when `connect()` replaces a
  connection). `client.lastSendSeq` exposes a send's `seq`.
- **A4 protection.** Refused for everyone, the owner included: removing a live
  avatar, an externally loaded node, or a subtree holding an avatar; an avatar
  `add` carrying a `parent`; an `add` under an avatar, an external node or a
  descendant of either; any `send` to an external node.
- **A5 name rules (D3)** for new names: non-empty, ≤256, not `__document__`,
  not ending `.camera`/`.light`, no `/`, unique across `_objectsByName`.
- **A6 subtree remove.** Children first; every map deletion guarded by object
  identity; hosted cameras and lights cleaned up completely; shared cameras
  survive.
- **A7 clients honour `add.parent`.** A missing parent emits `som:desync`,
  and `apps/client` reconnects through `trackConnect`.
- **A8 atomic rename.** `SOMDocument.renameNode`; the wire names the node by
  its old name; the requester applies the rename only on acceptance
  (`client.renameNode`); camera and light hosts refused (D4); a duplicate is
  `INVALID_VALUE`, not `INVALID_FIELD`.
- **A9 allowlist** grows by `name` on nodes, the external-node refusal, and
  D8's split teleporter message.
- **A10** `som:rename` consumers in `apps/client` (`rebuildPads`) and the
  inspector (rebuild the tree, keep the selection).

**Tests at `2dc3a196`** (Claude reran them on a clean install, each file on
its own, Node 22.22.0):
- server 21 files, **427** pass (new: `edit-plumbing.test.js` 41,
  `edit-e2e.test.js` 6);
- protocol **71**; som **200** (+10 in `som/tests`); `packages/client`
  **169**; `apps/client` **193**; renderer-three 64; interaction 9;
- 0 fail, 0 skipped. All nine proofs (a)–(i) were run by DeepSeek.

**Live holes this closed** (all on PROD before today, found while writing the
pre-brief; probes in pre-brief §2):
- a world's editor could **delete another visitor's avatar** with `remove`;
- **any visitor** could attach their own avatar under a world node (avatar
  `add` with `parent` skips the owner check);
- an `add` could go under a live avatar;
- adding then removing a node named `__document__` (or like an animation or
  `X.camera`) unregistered the real object, breaking World Info edits until a
  reload;
- removing a node orphaned its children, which stayed saved forever.

### 2.2 Label tracking (`a40d01a9`, fast lane)

- **The bug**, found in DEV acceptance of step 1a: after a pad was renamed,
  `rebuildPads()` (which removed labels by the `teleporter-` prefix) never
  removed its label again, and the next rebuild re-added the key.
  `LabelOverlay.addLabel` overwrote the map entry and **orphaned the old
  element**: frozen on screen, out of reach of `clear()`, surviving teleports
  until a page reload. Seen as a "Commons" label floating in the commons.
- **The fix** (`apps/client` only, 4 files): new `pad-labels.js` with
  `syncPadLabels()`, which removes exactly the labels it added last time and
  removes each key before adding it; `teardownWorld()` resets the key set;
  `LabelOverlay.addLabel` replaces an existing key.
- **Tests:** `apps/client` 193 → 200 (6 new, +1 from `import-guard`'s
  automatic check of the new import). The tests use a stand-in overlay
  because `LabelOverlay` needs a DOM and three.js. **Proof:** with the base
  prefix logic swapped in, 4 of the 6 fail.
- **Verified:** Claude (author); GLM `t_791ee2d5` APPROVE (counts, 4-file
  diff, proof reproduced); DEV deploy's own test run (27 suites, fail 0,
  skipped 0); **operator DEV acceptance** by label count (§7.6): 9 labels for 9
  pads before, through two renames and a full rebuild (old code: 11), and
  after the restores; a teleport carried no labels.
- `LabelOverlay.removeLabelsByPrefix` is now unused; left in place.

## 3. Findings

### 3.1 The kickoff asked the orchestrator for something it can't do
- The front door's kickoff told the orchestrator to extract and checksum the
  pre-brief from git. **The orchestrator profile has only `kanban_*` tools**, so
  it blocked (correctly) with kind `capability`.
- **It prefixed its own reason with `OPERATOR BLOCK:`**, which the guard treats
  as human-release-only, so the front door couldn't release it. The operator
  released it from the host (§7.4).
- **The fix that worked:** the front door posted the whole pre-brief as three
  comments on the kickoff. The operator verified it on the card: sha256
  matched, **0 of 720 lines missing** (§7.1).
- The front door recorded two rules in the skills: kickoffs carry the spec as
  text, never as a "go read the repo" step; agents never borrow the
  `OPERATOR BLOCK:` prefix.

### 3.2 The GLM brief
- **104 seconds**, and largely a reformatted pre-brief. Its three picks were
  fine (A3 `lastSendSeq`, A8 explicit `name` branch, A6 root-only
  `som:remove`).
- **Its own code references were wrong or missing:** a non-existent
  `case 'set'`; contradictory `renameNode` signatures; an external-name check
  `authorizeSend` couldn't make; an unrequested `add`-path refusal; no
  `edit:accepted` for `add`/`remove`; no remote-rename `som:rename`; no A7
  consumers; no `externalNodeNames` cleanup; no port-0 rule; no `canEdit`
  reset.
- **The operator posted correction C1–C10 on both the implementation and the
  review card** before releasing the gate. DeepSeek followed it, including
  reverting its own first C4 deviation.
- **Lesson:** when the pre-brief is this detailed, the brief step adds little
  verification. Check every code reference the brief makes; that's where it
  slips.
- **`hermes kanban show` truncates a run's summary to its first line.** Read
  summaries with `--json` (§7.2).

### 3.3 Outside review before DEV acceptance caught a real defect
Claude reviewed `a93b2ff` in its own checkout (via a review branch, §7.3),
reran every suite, and probed the code:
- **R1 (must fix, probe-confirmed):** a parented `add` made **every receiving
  client** send a malformed `send` (no `field`) and emit `edit:rejected` for an
  edit nobody made. `_onAdd`'s `addChild` ran outside `applyLocally`, and the
  node listener forwarded property-less mutations. Unit tests and GLM's
  review both missed it.
- **R2** the inspector's re-select after a rename could never fire. **R3**
  rename could act on a different object than the one authorized (duplicate
  node names). **R4** cosmetic.
- One DeepSeek revision fixed all four (`2dc3a19`); Claude reran everything
  and the R1 probe, both clean.
- **Keep doing this for full rounds:** the outside review was the step that
  found the defect.

### 3.4 Pipeline observations
- **The durable-block rule held, the other way round.** The gate was created
  `blocked` but not durably blocked by its creating run. When the brief
  finished, run 672 was dispatched onto it and **re-blocked it with
  `needs_input`**, as the 10-12 rule says. First time this was seen working.
- **The gate's comment named a card that doesn't exist** (`t_2b80db44`);
  cosmetic.
- **The sentinel completed early,** at 05:53 PT, right after the first review
  gate and before the revision round, DEV and release. The revision round's
  cards weren't wired into it.
- **DeepSeek's handoff gave totals,** not the per-file counts with commands
  the rules require.
- **Proof (a) needed a bigger break than specified:** the "subtree holds an
  avatar" check also covers the avatar itself. **Proof (e)'s end-to-end test
  didn't catch the two-counter break;** only the unit test did.

### 3.5 DEV acceptance with a helper account
- **Hermes ran the mechanical protocol checks** with its own DEV account
  `hermes-devcheck` and a public world `ep-check` (both left on DEV). The
  operator did the checks that need eyes: the visitor's console at the
  parented `add`, the renamed pad still teleporting, the regression walk.
- **Its browser session reset three times**, so steps 6–11 ran on a second,
  re-authenticated connection. One attempt went out anonymous and was
  refused, which incidentally previewed the non-owner checks.
- **A pasted URL with a double slash** (`wss://dev.ewwb.dev//worlds/…`) gets
  `WORLD_UNAVAILABLE`. `resolveWorldAddress` passes full `wss://` URLs through
  verbatim; normalising would be a small client fix.
- **Protocol inspector:** a second `hello` on the same connection gets
  `SESSION_CONFLICT` **and the server closes the socket.** One `hello` per
  connection.

### 3.6 §6 of the worker-card requirements made workers think they had no terminal (fixed)
- **What happened:** the label-tracking GLM review (`t_46559fd8`) blocked twice
  (runs 692, 693), each time saying it had only `kanban_show`. After two
  blocks the card went to `triage`.
- **The cause was the card text, not the tools.** The GLM profile log shows
  the same model (`z-ai/glm-5.3-flash`, the configured default) and a Docker
  sandbox in both the working run (675, a dozen `terminal` calls) and the
  failed ones, **which never tried `terminal`**. The front door added a new
  **§6, "Kickoff cards: the orchestrator profile has no terminal or file
  tools … only kanban_* tools"**, to
  `~/.hermes/skills/devops/atrium-workflows/references/worker-card-requirements.md`
  at 13:57 UTC today. **That file is pasted into every worker card.** GLM read §6
  as being about itself.
- **Proof:** the same card body with §6 removed, plus a one-line "this run
  HAS terminal, file and git tools", ran straight through (`t_791ee2d5`, 12
  terminal calls, APPROVE).
- **Fixed (~10:05 PT, by the front door, host-side skill edit):**
  - §6 deleted from `worker-card-requirements.md`; §7 renumbered to §6; the
    word "terminal" no longer appears in the file.
  - An editing rule at the top of that file: never describe any profile's
    tool surface there, because it is pasted into worker cards.
  - The moved content is now a subsection of
    `atrium-workflows/SKILL.md`, "Kickoff runs have no terminal, file or git
    tools", ending with a warning never to put it in a worker card body.
  - **Verified on the host:** the section list is §1–§6 with no "Kickoff
    cards" section, and `grep -c -i "no terminal or file tools"` on the file
    is 0 (§7.7).
- **Ruled out on the way:** no Hermes code change since 2026-09-05; no
  profile config change since before the working runs; disk 29%, Docker
  healthy. (The front door's first theory, a malformed `docker_forward_env`
  list, didn't fit the timeline. `atrium-glm`'s `config.yaml` does still
  carry that list alongside the JSON in its `.env`, while the default profile
  has only the `.env` form; worth tidying for consistency, but it isn't the
  cause.)

### 3.7 The `JSON.parse: unexpected end of data` console error, explained
When a connection fails, the app's `disconnected` handler reloads the world
in the address box (`app.js` ~L702). That box defaults to
`../../tests/fixtures/space.gltf` (`index.html` ~L432), which DEV and PROD
don't serve: a `404`, then a parse error on the empty body. Probably the same
at startup. Harmless; answers tint passdown §4.4's question. A fix: a default
that exists on the server, or skip the fallback on a 404.

### 3.8 Pre-existing issues found this round (not fixed)
- **Deleted nodes' meshes, materials and accessors stay in saved worlds.**
  Verified identical at the base. Edit mode's delete (1b) will make worlds
  grow; prune on remove or on save.
- **`add` still accepts a non-string teleporter destination** (correction C4
  kept the `add` path unchanged).
- **`packages/server/tests/external-refs.test.js`** (note `tests/`, outside the
  suite) fails 3 of 6 at the base: it calls `createSessionServer` without
  `httpServer`.
- **The client's `name` setter** (used when another client's rename arrives)
  still looks the node up by name, without R3's identity check. Only matters
  for duplicate node names; the server is the authority.

## 4. Claude cloud session notes
- **Push access:** `add_repo(access: "push")` clones to `/home/claude/atrium`;
  pushing `claude/*` worked first time. Deleting branches still doesn't.
- **Outside review of an unpublished SHA:** the operator pushes it to
  `review/<slug>-r1` from the host (§7.3); Claude fetches and reviews it.
- **Checking the operator's host from the chat:** one command block per turn,
  with expected output, worked well. Watch for blocks pasted twice (harmless
  so far) and for prompts pasted into a local shell.

## 5. What's next

### 5.1 Before the next round
- **Re-check §3.6 is still fixed** (§7.7); cards created before the fix still
  carry the old text.

### 5.2 In sequence
- **Phase 3 step 1b: Edit-mode UI.** Its own pre-brief, built from
  `PREBRIEF-edit-mode.md` §6 and F13–F17. Decide how it runs (D1): full
  pipeline, or a Claude-built prototype with a GLM review and DEV acceptance.
  - It can use `client.canEdit`, `client.renameNode`, `edit:*` events,
    `lastSendSeq`, `som:rename`.
  - Names it generates must pass the D3 rules.
  - Consider pruning deleted resources (§3.8) as part of it, since 1b makes
    delete common.

### 5.3 Small, fast-lane sized
- The static-world fallback that 404s on DEV/PROD (§3.7).
- Normalise a double slash in a pasted `wss://` address (§3.5).
- The client `name` setter's identity check (§3.8).
- The `add`-path non-string destination (§3.8).

## 6. Follow-ups

### 6.1 Closed this round
- **Externally loaded nodes are writable** (send-field-allowlist §6.1): closed
  by A4.
- **The pre-brief template's DEV plan should use the protocol inspector:**
  done in practice (§7.5).
- **The durable-block gate rule is untested:** observed working (§3.4).
- **The `JSON.parse` error after a home world loads:** explained (§3.7).
- **Delete `claude/teleport-rearm` and `-r2`:** done.
- **The label orphan** found during step 1a's DEV acceptance: fixed,
  `a40d01a9`.

### 6.2 New
- **§3.6:** fixed; re-check before the next round (§7.7).
- **Delete `claude/label-tracking`** (operator).
- **The sentinel isn't wired into revision rounds** (§3.4).
- **Mesh/material pruning on delete** (§3.8).
- **`external-refs.test.js` broken at base** (§3.8).
- **Tidy `docker_forward_env`** in the worker profiles' `config.yaml` to match
  the default profile (§3.6, not urgent).
- **DEV leftovers:** `hermes-devcheck` account and `ep-check` world (keep for
  future helper checks, or delete).

### 6.3 Carried over (still open)
- **From the tint and rearm passdowns:**
  - `atrium-deploy` health checks still use the `sslip.io` names;
  - the `file:///` security error right after a peer joins (seen again today
    on DEV).
- **From create-template §6.2–6.3:**
  - the stale `/workspace/atrium` checkout (`e66d99b`);
  - the 2026-10-09 items: `ewwb.dev` sign-in, re-saving the `sslip.io` pads,
    agent docs to `ewwb.dev`, recording the PROD commons owner, a DEV commons
    owner;
  - the Step 9 §6.3 list.
- **The GitHub PAT expires 2026-10-29** (16 days from this passdown).

## 7. Recipes

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 Verify a spec posted on a kickoff card, line by line
```
hermes kanban --board atrium show <kickoff t_id> > /root/kickoff-<slug>.txt
git -C $SC show <base sha>:devtasks/PREBRIEF-<name>.md > /root/pb-<slug>.md
sha256sum /root/pb-<slug>.md
awk 'NR==FNR{c=c $0 "\n"; next} NF && !index(c,$0){n++; print "MISSING: " $0} END{print n+0, "lines missing"}' /root/kickoff-<slug>.txt /root/pb-<slug>.md
```
Expect `0 lines missing`.

### 7.2 Read a run's full summary (a brief, a handoff, a verdict)
`show` prints only the first line of a run's summary. There's no `jq` on the
host:
```
hermes kanban --board atrium show <t_id> --json > /root/<name>.json
python3 -c "import json;d=json.load(open('/root/<name>.json'));print(d['runs'][-1]['summary'])" > /root/<name>.md
wc -c -l /root/<name>.md
```
Then, on your own computer: `scp root@5.78.232.73:/root/<name>.md .`

### 7.3 Outside review of an unpublished SHA
```
git -C $SC cat-file -t <sha>          # expect: commit
git -C $SC push origin <sha>:refs/heads/review/<slug>-r1
# after release:
git -C $SC push origin --delete review/<slug>-r1
```

### 7.4 Correct a brief, then release the gate
```
cat > /root/correction-<slug>.txt <<'EOF'
OPERATOR CORRECTION to the brief <t_id> ...
EOF
hermes kanban --board atrium comment <implementation t_id> "$(cat /root/correction-<slug>.txt)"
hermes kanban --board atrium comment <review t_id> "$(cat /root/correction-<slug>.txt)"
hermes kanban --board atrium complete <brief-review gate t_id>
```
Release a card an agent blocked with an `OPERATOR BLOCK:` reason (only a human
can):
```
hermes kanban --board atrium unblock <t_id> --reason "operator: <why>"
```

### 7.5 DEV protocol checks as the owner
- `https://dev.ewwb.dev/tools/protocol-inspector/`, signed in as the world's
  owner; connect to `wss://dev.ewwb.dev/worlds/<lowercase user>/<slug>`.
- **One `hello` per connection;** a second one is refused and the socket
  closes.
- Find a node's name: hover it in `apps/client` with the console open; it
  logs `[pointer] over <name>`.
- A helper agent with its own DEV account can run the mechanical part; keep
  the checks that need eyes for the operator.

### 7.6 Count pad labels (orphan check)
In `apps/client`'s console:
```
document.querySelectorAll('.pad-label').length
```
Must equal the number of pads in the current world. Firefox: the Debugger
tab (Ctrl+Shift+Z), Ctrl+Shift+F to search loaded files.

### 7.7 Check the worker-card requirements say nothing about tools
```
REQ=~/.hermes/skills/devops/atrium-workflows/references/worker-card-requirements.md
grep -n "^## " $REQ                                  # §1–§6, no "Kickoff cards" section
grep -c -i -E "no terminal|file tools|kanban_\* tools" $REQ   # expect 0
```
If a worker blocks saying it has no terminal, check its card body for any
sentence about a profile's tools before suspecting the tools themselves, and
check the profile's `agent.log` for `tool terminal completed` lines.
