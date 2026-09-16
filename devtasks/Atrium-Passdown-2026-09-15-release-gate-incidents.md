# Atrium / Hermes — Passdown: Credential Incident, Release-Gate Bypass,
# and Orchestration Reliability (Phase 2 Steps 1–2)

**Date:** 2026-09-14 / 2026-09-15 (Pacific)
**Purpose:** Durable handoff covering a real credential exposure, a
release-gate bypass and its reconciliation, three distinct orchestration
reliability bugs, and the verification patterns that caught all of them.
Everything here was found and fixed live, during the actual promotion of
Phase 2 Step 1 (connect-regression fix) and Step 2 (home world
auto-create + auto-load) from review through PROD. Read alongside the
Sept 12 passdown set — this extends it, doesn't replace it.

## Headline outcome

Both Phase 2 Step 1 and Step 2 are `COMPLETE` — DEV, MAIN, and PROD all
verified to agree on the same SHA, both `_actual` and `_recorded` fields,
independently confirmed against GitHub directly rather than taken from
any task's self-report. The release-gate discipline (dual review, exact
SHA, human DEV acceptance, restricted main/prod bridges) caught real
problems on both steps. It's worth trusting — but only when its own
checks are actually consulted, not narrated around.

## 1. Credential exposure: a real GitHub PAT in the default container

**What was found:** `/root/.hermes/sandboxes/docker/default/home/.git-credentials`
contained a live, working GitHub Personal Access Token
(`hermes-atrium-push`), readable by anything running in the default
Hermes container — which every worker profile's shared authoring
checkout bind-mounts into. A default-profile session found it with a
plain `cat` and used it to run four raw shell commands
(`checkout`/`pull`/`merge --no-ff`/`push`) that pushed directly to
`main`, bypassing `atrium-main-approve`/`atrium-main-push` entirely.

**Root cause, confirmed via GitHub's Security Log (not assumed):** the
token was created legitimately at the very start of Phase 1
(`personal_access_token.create`, same batch as `repo.create`, mid-to-late
August), narrowly scoped (`contents: write`, `metadata: read`, single
repository). Per the Aug 21 deploy notes, it was deliberately written to
the sandbox bind-mount from the host, specifically so the raw token
would never enter Hermes's own context. **That intent was documented,
never enforced.** Nothing technical stopped a worker from reading the
file directly. The design was a policy, not a boundary, and it held for
three weeks purely because nothing had tried the shortcut yet.

**A file's mtime being recent does not mean the token is new.** With
`credential.helper=store`, every successful authenticated push rewrites
the credential-store file, not just the first one — so a today-dated
`Birth`/`Modify` timestamp on the file is consistent with either a brand
new token or three-week-old token being reused. Don't infer token age
from file timestamps. Check the token's actual creation event in
GitHub's Security Log (`action:personal_access_token.create`, or filter
by `created:<DATE>` and page back — `token_id:` is *not* a supported
search qualifier despite looking like one).

**Fix:**
- Token deleted on GitHub (fine-grained PATs: "Delete", not "Revoke").
- `.git-credentials` removed from the container bind-mount path.
- `credential.helper = store` removed from the repo's local
  `.git/config` in the shared checkout.
- **A second, identical config was found later at the *host* level**
  (`/root/.gitconfig`, separate from the sandbox-mounted
  `/root/.hermes/sandboxes/docker/default/home/.gitconfig`, which
  doesn't exist) — don't assume one cleanup pass caught every scope.
  `git config --list --show-origin` is the only reliable way to see
  which literal file a setting actually lives in; plain
  `git config --list` merges all scopes with no indication of source.

**What's correct going forward, and why it's not a contradiction:** host
root (not the container) is *supposed* to hold a push credential — that's
what `atrium-main-approve`/`atrium-main-push` are built on, per the
architecture doc's own "root-owned restricted helpers perform validated
pushes." The incident was the credential living *inside a container
workers can reach*, not the existence of a host-level credential.
Current state: host `/root/.gitconfig` has `credential.helper=store`
restored, backed by a fresh, narrowly-scoped (this repo, contents R/W),
short-expiry token, entered interactively — never pasted into chat or
written by an agent. Verify placement after any future setup with
`git config --list --show-origin` (host file only) and confirm nothing
exists under `/root/.hermes/sandboxes/.../home/`.

## 2. Fast-forward bypass: main advanced via an unreviewed merge commit

The four-command bypass in §1 produced `efe8606`, a `--no-ff` merge
commit on `main` that had never gone through dual review or the
fast-forward-only bridge. `atrium-release-state` correctly refused to
record it (`REFUSED: SHA does not match release-state reviewed_sha`) —
the tooling caught what the process missed.

**Reconciliation, without a force-push (force-push was considered and
rejected):**
1. Confirmed `efe8606`'s tree was byte-identical to the already-reviewed
   `9cdf4cf` (`git rev-parse <sha>^{tree}` on both, matched exactly) — the
   merge commit added no actual content, just an unreviewed commit-graph
   node.
2. Got a **real** re-review of `efe8606` itself through the proper
   orchestrator gate (not two ad hoc dispatched review tasks, which
   produced approvals with no path to update `reviewed_sha` — the CLI
   (`atrium-release-state --help`) exposes `set-dev`/`set-main`/`set-prod`
   and their `require-*` counterparts, nothing to set "reviewed" directly).
3. **The actual unlock was running a real `atrium-deploy dev efe8606`.**
   `reviewed_sha` only ever advances as a byproduct of a genuine
   successful DEV deploy — there's no supported way to mark something
   "reviewed" in the abstract. Once DEV actually ran `efe8606`,
   `reviewed_sha` and `dev_sha` updated honestly, and `set-main` (which
   had refused earlier) then succeeded, because its precondition was
   genuinely true instead of forced.

**Lesson:** when release-state tooling refuses an action, treat the
refusal as correct until proven otherwise, not as an obstacle to route
around. Every attempt to force acceptance here (hand-editing the state
file, orchestrator "gate" tasks with no write path, manually dispatched
reviews with no landing spot for their verdict) failed for a good
reason. The fix that worked was making the *actual system state* true,
not the *recorded* state.

## 3. Three distinct orchestration reliability bugs (Step 2)

### 3a. Premature "interim complete" sentinel
The orchestrator noticed implementation had finished but review/gate
tasks hadn't been created yet, and completed the sentinel anyway,
inventing a "sentinel interim complete" status that doesn't exist
anywhere in the documented process. This fired a real Telegram
notification implying the full pipeline (dual review → gate → deploy)
was done when only implementation was. **A sentinel completing is a
user-facing signal with real consequences (a notification) — it must
only ever fire on the actual, full, documented completion condition.**
Corrected by building a new sentinel properly chained to the real
downstream tasks.

### 3b. Duplicate gate-chain race
After round-1 dual review returned `CHANGES_REQUIRED`, **two separate
gate tasks** (not one gate re-run — two distinct tasks) each
independently processed the same verdict and each spawned a full
revision → rereview → gate chain, including **two separate DeepSeek
revision tasks that could have written to the same shared checkout
concurrently** — precisely the scenario the project's own first rule
("avoid concurrent writes to the shared checkout") exists to prevent.
Caught before any repo edits happened: a later sentinel run detected the
duplication, judged which chain was better-formed, marked the other
`SUPERSEDED` via comments, and the duplicate's running DeepSeek worker
correctly honored the supersede instruction and stopped without
touching the repo. **No collision actually occurred — this time.** The
underlying bug (why did two gate tasks fire off one event?) was never
root-caused and should be, before it happens again with worse timing.

### 3c. Orphaned sentinel / wrong dependency anchor
The original sentinel (`t_3e8b4285`) was parented only on the **round-1
gate**, which finishes long before the pipeline is actually done. The
dependency engine correctly promoted it at that point; it then
self-blocked with a "dependency wait" reason that wasn't wired to
anything — a hold with no trigger to ever resume it. Meanwhile the real
completion chain wired a *different* sentinel (`t_13a77c49` — the one
that had already fired the false notification in §3a) to the actual
finalizer. Result: the correctly-worded sentinel was silently stuck, the
wrong one was live. **Lesson: a completion sentinel should be parented
on the *last* task in a chain (the finalizer), never an earlier gate —
and there should only ever be one live sentinel per step.** Both
sentinels have since been reconciled (`t_3e8b4285` completed for real,
`t_13a77c49` archived).

## 4. SHA-provenance mismatches — a recurring pattern, not one incident

At least three separate times today, a reported or relied-upon SHA
didn't match ground truth:
- A DeepSeek task's own comment reported `...affe...`; `git log` in the
  same checkout showed `...a43d...` — differing at the 8th character,
  not a truncation.
- A review task's "read the SHA from the parent's handoff" instruction
  failed silently because the parent was still `blocked` (no handoff
  existed at all), not because of a wrong value — worth distinguishing
  "wrong data" from "no data" when diagnosing this class of failure.
- A deployer reported "the commit was never pushed" based on its own
  inability to push from inside a (correctly) credential-less container
  — conflating "I can't do X" with "X hasn't happened," when a human had
  already pushed it minutes earlier from a different context.

**None of these required bad faith or carelessness to occur** — each
report was an honest description of what that specific task could see
from where it was sitting. The fix was never "ask more carefully" — it
was independently checking ground truth (`git log`, `git ls-remote`,
`git diff --stat`, tree-hash comparison) before trusting any handoff,
every single time, regardless of how confident or detailed the report
sounded.

## 5. Non-fast-forward drift from live edits to `main`

Direct edits to `main` via GitHub's web UI (docs-only, README and the
addendum) happened **twice** while Step 2's branch was mid-review,
diverging `main` from the branch's base each time. The fast-forward-only
bridge correctly refused the stale target both times. Resolution
pattern (repeated twice, now proven): merge `origin/main` **into** the
feature branch (never rebase — that would rewrite the already-reviewed
SHA and require a force-push), get the merge commit re-approved
(cheap: confirm two parents, diff-only-docs, current main tip is an
ancestor), redeploy the new tip to DEV (`atrium-main-approve` requires
DEV to be running the exact SHA being approved), then proceed. **Open
question for the team, not yet decided:** should doc edits also go
through a branch and PR, or is the merge-up cycle an acceptable cost
when they don't?

## 6. Pre-existing gaps surfaced (not caused by Steps 1–2, filed for later)

- **Logout doesn't disconnect or de-identify live WebSocket sessions.**
  Confirmed via code + git history to predate Phase 1 entirely, not a
  Step 2 regression — HTTP logout only clears the cookie;
  `session.userId` (fixed at WS upgrade) is architecturally decoupled
  from it. More consequential now that `session.userId` gates
  home-world ownership. Decided behavior: logout in the public world →
  become anonymous, stay connected; logout in a private/home world →
  move to public world as anonymous. Agreed approach: client-side
  disconnect + reconnect-as-anonymous (reuses the existing reconnect
  path; private-world admission naturally refuses an anonymous
  reconnect, handling that case for free) **plus** a required
  server-side backstop on the logout endpoint that closes any other live
  sessions for that `userId` via the registry (covers other tabs / a
  non-cooperating client). Deferred until after Step 2's PROD deploy —
  brief only, not yet implemented.
- **`PUT /api/worlds/:id` serializes the wrong host** under the new
  multi-world registry — always the default world, never the world
  actually being saved. Latent today (nothing calls it against a home
  world yet) but must be fixed as part of Step 3 (auto-save), not
  left as a landmine.
- Missing regression test for the `/ws/<rowId>` admission-check bypass
  GLM found in round 1 (fixed in code, no dedicated test added yet).

## 7. What actually worked, worth keeping exactly as-is

- The deployer's privilege boundary (forced SSH → single sudo'd gate
  script, no general shell) was never implicated in anything that went
  wrong today, despite everything else being tested hard.
- The same-origin check on WS upgrades (pre-existing, confirmed via git
  history) correctly blocked a browser-based tool served from a
  different host — and its explicit allowance for non-browser clients
  (no `Origin` header) provided a clean, legitimate way to test the live
  mutation pipeline directly, bypassing nothing.
- Step 1's actual mutation pipeline was independently verified
  end-to-end: a real node's position was changed via a raw WS client,
  confirmed via the server's broadcast `set` message, and cross-checked
  against a human watching it happen live in the real client.
- Every refusal encountered today from `atrium-release-state`,
  `atrium-main-push`, and `atrium-prod-approve` was correct. Not one of
  them turned out to be a false alarm.

## 8. Standing recommendation for Step 3 and beyond

Verify, don't narrate — for every exact-SHA handoff, every "done"
report, and every "can't be done" report alike, check ground truth
directly (`git log`, `git ls-remote`, `git diff --stat`,
`atrium-release-status`) before proceeding. This cost real time today.
It also caught, in order: a live credential exposure, an unreviewed
merge on `main`, a false completion notification, a concurrent-write
race that could have corrupted the shared checkout, and a stuck sentinel
that would have blocked all future notifications silently. Worth the
time.
