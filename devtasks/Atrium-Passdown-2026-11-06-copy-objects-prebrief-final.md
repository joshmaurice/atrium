# Passdown 2026-11-06 (evening): `copy-objects` pre-brief FINAL; the round is next

This supersedes `Atrium-Passdown-2026-11-06-richer-add-shipped.md` as the
starting point. Read this file first. That passdown's host, connector and
convention notes, its lessons (§3) and its cheap-round recipe (§4) still hold;
its follow-ups and cleanup are carried in §6 and §7 here.

**First instruction for the next session's Claude:**
1. Clone the repo (`add_repo` `joshmaurice/atrium` with access `push`, clone to
   `/home/claude/atrium`) and read this file, then
   `devtasks/PREBRIEF-copy-objects.md` **FINAL Rev 2**: it is the round's whole
   contract (K0–K10, §5 tests and proofs, §6 commits and files).
2. **Implement it in Claude's fast lane** (CP-L8 (a)) on a new branch
   `claude/copy-objects` from `main` at `db9efc4` (or later, if only
   `devtasks/` moved), in §6's five commits, **K0 first**. Then a fresh Claude
   agent that didn't write it checks the code against the pre-brief, then one
   ChatGPT code review (write its prompt pinned to the published SHA, named
   distinctly: `OUTSIDE-REVIEW-PROMPT-copy-objects-code.md`).
3. **Use the `atrium-ops` connector** for board, release, log and git state. It
   is read-only.
4. **The release rule is unchanged:** from the round's DEV release merge until
   PROD is `COMPLETE`, push **nothing** to `main`, except a revision that
   supersedes a DEV the host hasn't accepted.
5. **Cost matters:** no OpenRouter credit (fast lane, ChatGPT reviews, host
   deploy).
6. **Give the operator host commands with no leading spaces,** and real paths.
7. **Before acting on an outside review, check the SHA it names** in its first
   lines.

## 1. Where things stand
| What | State |
|---|---|
| Release | `COMPLETE`. DEV = PROD = **`3fcc296c`** (`richer-add`). `main` is **`db9efc4`**: `3fcc296c`'s code plus `devtasks/` and `docs/` only |
| The contract | `devtasks/PREBRIEF-copy-objects.md` **FINAL Rev 2** (approved 17:09 PT) |
| Live on PROD, found this session | **No 1 MiB message cap on PROD's path.** `createWorldHost`'s `WebSocketServer` (`world-host.js` L46) and the refusal socket (`world-registry.js` L67) set no `maxPayload`, so `ws`'s 100 MiB default applies to every visitor, anonymous included. Reproduced three times (fresh agent, Claude, the Claude review: a 1.13 MiB `add` accepted and stored). **Fixed by this round's commit 0 (K0)**, by the operator's choice (PC (b)), not a separate round |
| Board | No cards this session. `add-check`'s leftovers `t_d6c11601` and `t_82771022`, if not yet archived (§7) |
| Branches on GitHub | as before: `claude/richer-add`, nine `release/*` refs, `workflow/undo-hold`, `workflow/scripting-4d-1` (§7) |

## 2. What this session did
- **Carved `copy-objects` out of `PREBRIEF-richer-add-copy.md` Rev 0.4** into
  its own pre-brief, rechecked against the code at `f286d283`. The old file's
  status points at the new one.
- **New facts found while rechecking:** a pad's destination is a path resolved
  against the world it's in (a pasted pad would lead elsewhere on another
  server); the client can't name every world's owner (the commons is `/`, a
  slug can be renamed through the API), so `hello` now carries the world's id
  and owner; ids are per server; a paste always lands on the page's own
  server on PROD.
- **A fresh agent checked Rev 1** (58 of 67 facts right) and found the
  missing cap. Rev 1.1 took every finding.
- **Operator decisions** (Rev 1.2, then CP-L5 again in Rev 1.3): PC (b),
  CP-L3 (c), CP-L5 (d), the rest as recommended.
- **Two outside reviews of Rev 1.2** at `2746d663`, both CHANGES REQUESTED:
  `REVIEW-copy-objects-rev1.2-chatgpt.md` (source-only; only its summary was
  pasted, its full file was a download) and `REVIEW-copy-objects-rev1.2-claude.md`
  (runtime, with probes). Rev 1.3 took every finding; FINAL Rev 2 changes no
  text.
- **Design:** `docs/DESIGN-phase3-placement-scripting.md` §7 item 9, remote
  data for behaviours, recorded as deliberately later (the operator's
  question: today no graph operation reaches the network).

**The decisions, in one place** (the pre-brief's §3 has the arguments):
| | Decision |
|---|---|
| PC | the cap fix is commit 0 of this round (K0), the refusal socket included |
| CP-L1 | a read-only Inspect mode for visitors; Copy and Paste for owners in Edit mode |
| CP-L2 | a clipboard of one object, in memory, a snapshot taken at Copy |
| CP-L3 | (c): `hello` carries `world: { id, owner?: { id, name? } }`; the credit stores ids, names as seen at Copy, and the server; worded as claimed |
| CP-L4 | the server checks the credit's form and bounds only |
| CP-L5 | (d): same world, kept as Duplicate; another world, disabled, every foreign id swapped for a fresh one, and a record of what each stood for in `copiedFrom.refs` |
| CP-L6 | model URLs and pad destinations made absolute against the source server at Paste; a third-party model host asks first |
| CP-L7 | the "visitors can see and copy" note in Inspect and beside the Public/Private toggle |
| CP-L8 | the fast lane, as `richer-add` |

## 3. Lessons
### 3.1 Claude talked the operator into a rule the reviews took apart
CP-L5's "middle path" (keep foreign ids, defuse only those that match the
destination) was Claude's proposal, and the operator chose it on Claude's
argument that it "kept everything in the friendly case" and that a template
could be re-aimed. Both reviews showed it kept nothing usable (the runner
won't load a behaviour with an unresolved reference, `runner.js` L355–367;
"Choose a target…" shows for a kept id and a fresh one alike) and had holes
(Redo restores old ids; **another tab's** Undo and Redo stacks are invisible).
Claude told the operator so plainly and the operator re-decided. **Before
recommending a safety rule, trace it through what the runtime actually does
with the thing kept, and through every way an object can come back: Undo,
Redo, and other tabs.** (Passdown 11-06 §3.2's lesson, again: trace a rule
through every flow it pairs with.)

### 3.2 A limit two rounds relied on didn't exist on PROD's path
`add-check` and `richer-add` reasoned from "the 1 MiB message cap". It is set
only on `createSessionServer`, the path the tests use; PROD's world host never
had it. **When a design relies on a transport limit, check it on the path
production actually takes**, not the one the tests cover.

### 3.3 Two reviews of one SHA, in parallel, worked
ChatGPT (source-only) and a Claude runtime review of the same pinned commit
agreed on the main finding independently, and each found things the other
didn't. Both named the SHA in their first lines, as the prompt asked.

### 3.4 The operator prefers plain discussion for subtle decisions
On CP-L5 the operator answered the multiple-choice question with questions,
then asked to "discuss this issue in the normal way". For a decision with a
subtle trade-off, explain in prose and ask once; keep AskUserQuestion for
crisp choices.

### 3.5 Session mechanics
- `better-sqlite3` builds in the cloud session with
  `node /opt/node22/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/opt/node22`
  in its package directory.
- Server test files one at a time, each under `timeout 180`; new tests on port 0.
- The fresh agent's and the Claude review's probes (`/tmp/copy-check/`,
  `k0-worldhost.mjs`, `k7-replace.mjs`) aren't in the repo; the Claude
  review's appendix has the code of both. K0's §5 test replaces the first.

## 4. The round, as the pre-brief sets it
1. **Commits** (§6): 0, K0 (the cap, with a test that fails first); 1, K2–K3
   (the credit vectors and both checks); 2, K1 (`hello`, schema, client check);
   3, K5–K8 (`copy-paste.js`); 4, K4, K6's and K9's `app.js` and `index.html`
   glue, the end-to-end tests, full suites, proofs (p0)–(p5), (p1b), and the
   handoff (`devtasks/HANDOFF-copy-objects.md`).
2. **Files:** only those §6 lists. If another must change, stop and ask.
3. **`p6`** gains this round's counters and its stale heading is fixed (§6).
4. **Before DEV**, the operator answers two questions (below).
5. **Host:** as the 11-06 passdown §4: `atrium-deploy-gate "dev <sha>"`, the
   operator's DEV acceptance (§5 of the pre-brief), `atrium-main-approve … &&
   atrium-deploy-gate "main …"`, the `p6` survey, `atrium-prod-approve … &&
   atrium-deploy-gate "prod …"`. Claude gives the commands with the real SHA.
   The DEV gate merges `main`'s `devtasks/` into the branch, so check
   `git diff <reviewed> <dev> -- . ':!devtasks'` is empty before MAIN and PROD.

**For the operator, before the round's DEV deploy:**
- Does the host's proxy (Caddy) cap WebSocket frames? It says how exposed PROD
  is until K0 ships.
- Does the DEV commons have an owner? The DEV acceptance expects the pasted
  crate's credit to name one (or none, if it has no owner).

## 5. What's new in the repo
- `devtasks/PREBRIEF-copy-objects.md` (FINAL Rev 2);
- `devtasks/OUTSIDE-REVIEW-PROMPT-copy-objects.md` (the pre-brief's prompt);
- `devtasks/REVIEW-copy-objects-rev1.2-chatgpt.md`,
  `devtasks/REVIEW-copy-objects-rev1.2-claude.md`;
- `docs/DESIGN-phase3-placement-scripting.md` §7 item 9.

## 6. Follow-ups
1. **Next: the `copy-objects` round** (§4).
2. **After it:** the subtree `add` (PROD's 9 objects with children), the next
   placement round (RA-L6 (a)).
3. **Recorded in the pre-brief, not this round:** a rebinding UI for a pasted
   custom graph's references (`copiedFrom.refs` is its input); several objects
   at once; a clipboard that survives a reload; the client's missing animation
   check in `atriumProblem`; healing a malformed saved credit at load; any
   future import must stamp fresh ids (K10).
4. **Carried from the 11-06 passdown §6:** `richer-add`'s nits N1 and N2; the
   audit items (node `extras` finiteness, `send`'s cutoff on non-MASK, a
   per-world resource budget); `initDocumentView` passing the renderer as the
   document; PROD's one object with a non-unit rotation; and its own carried
   list (the hidden host tab, choppy behaviour objects, `add-check`'s test
   nits, the registry race at teardown, "Custom graph", 4d-1's three items,
   `c2.py`'s flake, the kickoff template).

## 7. Cleanup (operator, on the host; carried, if not yet done)
```bash
hermes kanban --board atrium archive t_d6c11601
hermes kanban --board atrium archive t_82771022
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/richer-add release/4b3393db219d
```
The first two lines only if those cards are still there. The other `release/*`
refs (`2f28f030ec72`, `3cfeeed9a8bf`, `4f66f93b7f8b`, `769825ce3781`,
`85669db0f8a9`, `a096cf3f8fcf`, `e536913011cc`, `fe4dcbb34ed7`) and
`workflow/undo-hold` and `workflow/scripting-4d-1` can go the same way.
