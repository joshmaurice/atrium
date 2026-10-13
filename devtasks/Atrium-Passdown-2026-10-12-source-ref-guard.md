# Atrium Passdown — 2026-10-12 — Phase 3 design, and the `source-ref-guard` security release

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-09-domain-ewwb-commons-owner.md`.
Its open items, all still open, are in §6.3. The Step 8 §8 and Step 9 §7
recipes still hold.

**First instruction for the next session's Claude: clone the repo and read
`devtasks/` before advising.** List `devtasks/` by date and read **every**
passdown newer than the one you think is latest. This session nearly missed
the 2026-10-09 passdown (§4.3).

## 1. Status at handoff

| Item | State |
|---|---|
| Release state | **COMPLETE** (`atrium-release-status`, 2026-10-12 ~18:13 PT) |
| DEV / MAIN / PROD | all at `525df00d83bc0faf113540a76ce33f4158aa722c` |
| `main` now | `9963158` (two doc renames on top of `525df00d`; no code) |
| Base for this round | `225a1038c8320a98861fb4cdeb3576d088663590` |
| Review branch | `review/source-ref-guard-r1`, used for the outside review, deleted after release |
| Workflow branch | `workflow/source-ref-guard`, published |

**Board:**
- `t_034cf911` kickoff — done
- `t_e8844181` GLM brief — done
- `t_18b17ed2` brief-review gate — done (operator)
- `t_83d3eaca` DeepSeek implementation — done
- `t_dbfd34d4` GLM review — done, APPROVE
- `t_7dc2b300` review gate — done
- `t_9a008e0e` PROD gate — done
- `t_b31bee06` PROD deploy — not checked; PROD state confirms the deploy
- **`t_29acdd40` sentinel — still `todo` at handoff.** Check it and close or
  archive it before the next kickoff: the guard auto-links the review gate
  only when exactly one sentinel is open.

**Not confirmed:**
- Whether publish, DEV-deploy and finalizer cards exist under titles without
  the slug. DEV did reach `525df00d` and reported healthy.

## 2. What shipped (security)

**The vulnerability.** `extras.atrium.source` on a node names a glTF file
to load into it.
- **What the server did:** in **document worlds** (DB-stored and
  owner-editable: home worlds, and the PROD commons since 2026-10-09), it
  fetched those URLs itself on world load. It used a bare `fetch()`, with no
  address, size or time limits.
- **Who could plant one:** any account holder, in their own world. Autosave
  kept it, and the next load made the server fetch it.
- **The risk:** blind request forgery from the VPS, and memory exhaustion.
- **How long:** present since document worlds arrived (2026-09-14).
- **Found by:** Claude, while checking a Phase 3 design review finding.
  Reproduced locally; not exploited on PROD (§3.4).

**The fix** (three commits on `225a103`; server only; no protocol, schema
or client change):

| Commit | Change |
|---|---|
| `34f2588` | `session.js`: exported pure guards `addSetsAtriumSource(node)` and `sendSetsAtriumSource(field, value)`. `add` and `send` refuse any write of `extras.atrium.source` with `PERMISSION_DENIED` and the message `extras.atrium.source cannot be set by clients`. The guards apply to everyone, owner and avatars included, and run before the mutation gate |
| `2e8694a` | `world.js`: document worlds never fetch on the server. `resolveExternalReferences` only logs a count-only warning. File worlds (`createWorld`) are unchanged |
| `525df00` | New `packages/server/test/source-ref-guard.test.js`: 21 tests, port 0 |

- **The `send` guard works on parsed path segments** (the same `parsePath`
  that `setPath` uses). It finds the protected shape at any depth, so writing
  the path differently, or reaching another node's `extras` through the path,
  can't get round it. Names that only start with "source", such as
  `sourceCount`, are still allowed.
- **Why it's written this way:** the outside review of the brief (§3.2).

**Tests at release** (GLM, Node 22.23.2; re-run by Claude in the sandbox,
Node 22.22.0, same results):

| Suite | Result |
|---|---|
| Server, 18 files, each run on its own | 330 pass, 0 skipped, all exit on their own (`world-visibility` about 60 s) |
| `source-ref-guard.test.js` | 21 pass |
| `packages/client` | 140 pass, 0 skipped, about 49 s |
| `apps/client` | 191 pass, 0 skipped |

**Proofs of failure** (GLM ran all five; Claude re-ran (a) and (c)). Every
file exited on its own:

| Proof | Break | Failures |
|---|---|---|
| (a) | `world.js` restored to base | 1: the document-world "no network request" test |
| (b) | `add` guard call disabled | 3: the open-world add, the avatar add, the owner-world add |
| (c) | `send` guard call disabled | 5: the open-world send, the owner send, `parent.extras`, `children[0].extras`, the dotted path |
| (d) | direct-path case dropped from the `send` guard | 3 |
| (e) | `send` guard replaced by the brief's original raw-string version | 7: the bypass tests, plus the `sourceCount` over-blocking control |

## 3. How the round went

| Stage | Outcome |
|---|---|
| Pre-brief | `devtasks/PREBRIEF-source-ref-guard.md`, FINAL Revision 1. S1–S5 confirmed by the operator; ChatGPT reviewed it twice and recommended approval |
| Kickoff `t_034cf911` | Through the front door. The front door embedded the full pre-brief in the card, and verified the base SHA independently |
| GLM brief `t_e8844181` | About 1 minute. **Its `send` guard was bypassable** (§3.2) |
| Brief gate `t_18b17ed2` | The operator posted a correction comment on `t_83d3eaca`, then completed the gate |
| DeepSeek `t_83d3eaca` | `525df00d`, following the correction exactly |
| GLM review `t_dbfd34d4` | APPROVE, 0 findings, proofs (a)–(e) re-run. Its `kanban_complete` metadata retry failed; the verdict is restated in a comment |
| Outside review (Claude) | Through `review/source-ref-guard-r1`. Diff limited to the three files; all suites and proofs (a) and (c) re-run. Approved |
| DEV acceptance | Passed on `dev.ewwb.dev`: `atriumClient.addNode(...)` with a `source` → `PERMISSION_DENIED` |
| MAIN, PROD | Step 8 §8.1 and §8.2 recipes, first time, no problems |

### 3.1 Pre-release checks on PROD (pre-brief §7.1–7.2)
- The JSON-aware DB query for stored `extras.atrium.source` returned **no
  rows**.
- `journalctl -u atrium --since 2026-09-14 | grep "External ref"` returned
  **nothing**.
  - **Caveat:** journald retention may not reach back to 2026-09-14. Check
    the oldest retained line with `journalctl -u atrium | head -1`.
- **Conclusion:** no sign the hole was used. The §7.3 cleanup was not needed.

### 3.2 The brief's `send` guard, and the correction
- **The gap.** GLM translated the pre-brief's S2 examples into raw string
  comparisons on `msg.field`. But the server's `parsePath` and `setPath`
  accept other ways of writing a path, including paths that reach another
  node before its `extras`. So a raw-string guard could be bypassed. It also
  over-blocked fields that merely start with `source`.
- **The pre-brief shared the gap:** its examples only covered paths
  starting with `extras`, and Claude's prototype patch had the same
  narrowness.
- **How it was found:** while reviewing the brief. ChatGPT, given the brief
  for an outside review, confirmed it and proposed the segment-based rule
  that shipped.
- **The fix:** an operator correction comment on the implementation card
  (overriding the brief), with extra pure and integration tests and proof
  (e). The comment is preserved on `t_83d3eaca`.

### 3.3 Corrections to this session's own documents
- **Pre-brief §2 said** `extras.atrium.source` "can be set directly whenever
  the node already has `extras.atrium`". **That's wrong.** `setPath` only
  assigns properties that already exist (`key in target`), so a direct write
  only works when `source` is already present. Replacing a whole `extras` or
  `extras.atrium` object is what actually plants a new one.
- **The prototype patch is superseded** by `525df00d` (it lacked the
  segment-anywhere rule). Don't use it as a reference.

## 4. Process notes

### 4.1 What worked
- **Prototyping and attacking the bug before writing the pre-brief.** A
  local reproduction, then a fix tested end to end, including a `source`
  planted directly into the DB.
- **An outside review of the *brief*, not only of the SHA.** It caught the
  guard gap before any code was written.
- **Correcting a brief through a comment on the implementation card,**
  instead of re-running the brief stage.
- **A proof that runs the brief's own version** (proof (e)). It shows the
  tests would have caught the original design.
- **Checking the sentinel and the PAT before kickoff** (the PAT expires
  2026-10-29), plus a `git push --dry-run` to confirm push credentials.

### 4.2 Lessons
- **A security guard on `send` must use the server's own path semantics.**
  `parsePath` ignores stray dots, and `setPath` follows any property chain.
  Raw string checks on field paths aren't safe.
- **The real fix is broader than this guard** (§6.1).
- **Browser re-downloads add "(2)" to file names.** The pre-brief and design
  doc were uploaded as `…(2).md`. The front door caught it, and the files
  were renamed only *after* the release, because a commit on `main`
  mid-round would block the MAIN fast-forward.
- **Kickoff text is for the front door, not the shell.** It was pasted into
  bash once; bash rejected every line as a syntax error, and nothing ran.

### 4.3 Reading order
- The 2026-10-09 passdown arrived with a 2026-10-11 upload, and was missed at
  first because only the older passdowns were listed.
- It changed three things: the hostnames (`ewwb.dev`, `dev.ewwb.dev`), the
  PROD commons (now an owned document world), and the Create-copies-commons
  finding.

## 5. Documents produced this session

| File | What |
|---|---|
| `docs/DESIGN-phase3-placement-scripting.md` | Phase 3 design (object placement and scripting), **Revision 1.1**. Two ChatGPT reviews are logged in its §11. Step 0 (this fix) is now done; step 0b and step 1 are next |
| `devtasks/PREBRIEF-source-ref-guard.md` | The security pre-brief, FINAL Revision 1 (§3.3 corrects one claim in it) |

**Phase 3 direction, settled 2026-10-11/12** (design doc §10, all seven
decisions made):
- every world node editable in Edit mode, except avatars and nodes loaded
  from a model reference;
- models by URL through a new client-only field, `extras.atrium.model`;
- behavior graphs (`KHR_interactivity`, ratified) first, then a graphical
  editor, then owner-only JavaScript;
- a server-assigned script host;
- visitors can trigger behaviors while the owner is present;
- script source is visible to visitors;
- the commons is editable by its operator-owner.

## 6. Follow-ups

### 6.1 New this session
- **Restrict what a client `send` may traverse or write (security
  hardening).**
  - **Why:** `setPath` follows any property chain from the addressed object,
    including into other nodes and the document. That bypasses checks tied
    to `msg.node`.
  - **The fix:** an allowlist of writable fields, checked with the same
    resolution as `setPath`.
  - **Before adopting it:** check it against the inspector's and the
    client's existing edit paths.
  - **Recommended before Phase 3 step 1,** since Edit mode multiplies `send`
    traffic.
- **DEV console: `Security Error: Content at https://dev.ewwb.dev/apps/client/ may not load or link to file:///`.**
  Seen during DEV acceptance. Probably not caused by this change, which was
  server only. Find which client code builds a `file:///` URL.
- **File-world fetches** (operator-controlled) still have no size or time
  limit (pre-brief §5 Q1).
- **Sentinel `t_29acdd40`** is still open (§1).

### 6.2 Next in sequence (design doc §9)
- **Step 0b:** Create stops copying the live commons (2026-10-09 passdown
  §4). The operator decision is pending; option B, a fixed template, is
  recommended. Write its pre-brief.
- **Then Phase 3 step 1** (Edit mode). Needs its own pre-brief: the
  `requestSeq` protocol addition, atomic rename with `INVALID_VALUE`, and
  the avatar-edit refusal.

### 6.3 Carried over from 2026-10-09, all still open
- Confirm sign-in on `ewwb.dev`.
- Re-save teleporter pads that point at `5.78.232.73.sslip.io`.
- Update agent instructions (SOUL.md, skills, card templates) and docs to
  the `ewwb.dev` names.
- Record the PROD commons owner username.
- Check whether DEV has a commons owner set.

### 6.4 Carried over from the Step 9 cleanup passdown
- Its §6.3 list is unchanged: hello timeout, F-10 browser smoke stage,
  hard-reload 404, and so on.
- The GitHub PAT expires **2026-10-29**.

## 7. Recipes used this session

`$SC` = `/root/.hermes/sandboxes/docker/default/workspace/atrium`

### 7.1 Base SHA from the host
```
git -C $SC fetch origin main && git -C $SC rev-parse origin/main
```

### 7.2 Pre-kickoff checks
```
hermes kanban --board atrium list | grep -i sentinel | grep -v -E " done | archived "   # expect nothing
git -C $SC push --dry-run origin origin/main:refs/heads/credcheck-dryrun                # expect "[new branch]", nothing created
```

### 7.3 Read a card's brief or verdict
```
hermes kanban --board atrium show <t_id> | sed -n '/Latest summary/,/^Events/p'
```

### 7.4 Correct a brief before implementation
1. Write the correction to a file:
   ```
   cat > /root/correction-<slug>.txt <<'EOF'
   ...
   EOF
   ```
2. Post it on the implementation card:
   ```
   hermes kanban --board atrium comment <implementation t_id> "$(cat /root/correction-<slug>.txt)"
   ```
3. Check the implementation card's `parents:` line lists the gate, then
   complete the gate:
   ```
   hermes kanban --board atrium complete <gate t_id>
   ```

### 7.5 Outside review of an unpublished SHA (Step 9 §7.3)
```
git -C $SC push origin <sha>:refs/heads/review/<slug>-r1
git -C $SC push origin --delete review/<slug>-r1     # after release
```

### 7.6 Search PROD for stored `extras.atrium.source` (read-only)
See `PREBRIEF-source-ref-guard.md` §7.1. It's a `json_tree` query with a
`LEFT JOIN`, run with `sqlite3 -readonly`.
