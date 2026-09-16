# Atrium / Hermes — Passdown: Client Auto-Connect Fix, Deploy
# Permissions Bug, Unauthorized Main/Prod Update, and a
# Long-Standing Hostname/Certificate Mismatch

**Date:** 2026-09-15 / 2026-09-16 (Pacific)
**Purpose:** Companion to `Atrium-Passdown-2026-09-15-release-gate-incidents.md`,
which covered Steps 1–2. This one covers what shipped as
`aa005622c3da3fecb3806467d9d8dd62554200f4` — a real, confirmed
deploy-tooling bug that broke login on both DEV and PROD, a second
unauthorized main/prod update, and a hostname mismatch that looked like
a live outage but wasn't.

**Naming correction, made explicit on purpose:** the Kanban tasks for
this work were created by the orchestrator under the label "Step 3"
(e.g. `t_78c3eb32`, "Step 3 — Review + gate + DEV deploy (client
auto-connect)"), and that label got repeated in conversation and in an
earlier draft of this document. **That label is wrong.** Per
`ADDENDUM-user-accounts-phase2.md`'s own sequencing, Step 3 is
**auto-save** — it has not been started. What actually shipped here was
a small follow-up completing something Step 2 was already supposed to
do: the addendum said home worlds would be "auto-loaded... using the
same resolution path as any other world," but Step 2 as reviewed and
shipped only ever touched server files — `apps/client` was never
touched, so nothing on the client actually initiated a connection after
login. This fix closes that specific gap. Referred to below as **the
client auto-connect fix**, not "Step 3." Auto-save is still next.

## Headline outcome

The client auto-connect fix is live and verified on DEV, MAIN, and PROD
— confirmed by directly fetching the real file from the real production
hostname and reading its content, not by trusting a status report. Two
real bugs were found and are still open (the deploy tool's file
permissions, and a stale hostname reference). Nothing shipped broken to
end users in the end, but it was close.

## 1. The gap this fix actually closes

Step 2, as implemented and reviewed, touched only server files
(`home-world.js`, `world.js`, `world-registry.js`, `http-routes.js`,
`home-world.test.js`). The addendum's "auto-loaded on login" language
was ambiguous about whether it covered the client-side trigger too, and
what got briefed only covered the server half: the registry could
auto-instantiate a home world the moment something connected to it, but
nothing on the client ever initiated that connection. After login, the
client only updated its own auth-display state. The server-side
capability was real and correct; the client-side trigger to actually
use it had simply never been built. Filed and completed as its own
small, client-only task (`t_d6b995e4` → `aa005622...`).

## 2. A fourth instance of the stage-transition reliability gap

After the brief and Nemotron's critique finished, no implementation
task was created — the third time in two days a pipeline stage failed
to auto-advance without a human noticing and prompting a manual
creation (previously: implementation not created after Step 2's
brief-critique; two gate tasks firing off one event and creating
duplicate chains). This is a structural issue, not something to keep
patching per-occurrence: the orchestrator currently creates each next
stage reactively, after noticing a completion, rather than wiring the
entire pipeline's tasks up front as real Kanban dependencies with the
dependency engine handling promotion on its own. **Not fixed yet** —
worth doing before actual Step 3 (auto-save) starts, since every
additional pipeline stage increases the number of moments this can
silently stall or double-fire.

## 3. Review found real issues, and correctly built on prior findings

GLM's brief extended scope reasonably on its own judgment (added
page-load session-restore auto-connect, grounded in an existing `me()`
code hook, disclosed with real reasoning when asked). Round-1 review
returned `CHANGES_REQUIRED` with 3 MAJOR findings, addressed in
revision, round-2 rereview `APPROVE`. Two findings explicitly build on
earlier incidents rather than starting fresh: a guard against
`home_world_creation_failed` re-applies Step 2's own MAJOR-4 finding, and
a guard against leaving the UI stuck in "Connecting..." directly defends
against the very first bug this whole thread chased (the original
`/apps/client` routing 403). The review process is drawing on
institutional memory, not reviewing in a vacuum.

## 4. The real bug: a confirmed, reproducible file-permission bug in the deploy tool

**Symptom chain (all one root cause):** auto-connect silently not
firing, login doing nothing at all in a fresh Opera window, and the
Register/Login toggle not responding in a fresh Firefox window all
turned out to be the same thing: `apps/client/src/app.js` was being
served with a `403 Forbidden`. If the browser can't load the script at
all, nothing on the page works — every one of those symptoms is
explained by that single fact, and the browser differences were just
whichever tab happened to have an old cached copy versus one forced to
fetch fresh.

**Root cause, found by checking actual file permissions on disk:**
```
-rw------- 1 root root 27647 Sep 15 21:17 app.js          (0600)
-rw------- 1 root root  1980 Sep 15 21:17 wsUrl.js         (0600)
-rw-r--r-- 1 root root  2054 Aug 22 21:40 LabelOverlay.js  (0644, untouched)
-rw-r--r-- 1 root root  2544 Aug 22 21:40 auth.js          (0644, untouched)
```
Only the two files the deploy actually wrote came out `0600`
(root-only, unreadable by Caddy). Files sitting in the same directory
that the deploy didn't touch were correctly `0644`. This points squarely
at the deploy tooling's own file-write step — almost certainly an
overly restrictive umask (e.g. `077`) in effect during checkout — not
at anything about these two files specifically.

**A one-time manual `chmod` is not a fix and should never be mistaken
for one.** It was applied to unblock testing, but the underlying tool
was never patched. This was proven directly, at real cost:

- A "redeploy to verify the fix" produced files with the *same old
  timestamp* — the deploy tool detected `OLD_SHA == TARGET_SHA` and
  skipped the checkout/write step entirely. The manual chmod was still
  the only thing on disk; nothing had been re-tested.
- Deleting the files to force a genuine fresh write hit a real design
  flaw: `atrium_deploy` refuses to run at all if the working tree has
  local modifications (it saw the deletions as `D` in git status) — a
  genuine catch-22, since restoring the files makes the SHA match again
  and the checkout gets skipped once more. **The tool currently has no
  way to force a real re-checkout when the target SHA is already
  current**, and this isn't a corner case — it will bite the very next
  attempt anyone makes to re-verify a fix, for exactly this reason.
- Worked around (not fixed) by deploying to a different, real SHA first
  (`c9257e1`, Step 2's already-approved tip) and then back to
  `aa005622` — two genuine `OLD_SHA != TARGET_SHA` transitions, which
  the tool has no special-case skip logic for.
- That real test **confirmed the bug is live**: fresh checkout, fresh
  timestamp, permissions came back `0600` again. Not fixed. Reproduced
  a second time, independently, on **PROD's own checkout**
  (`/srv/atrium/apps/client/src/{app.js,wsUrl.js}`, also `0600`,
  timestamp matching the same test window) — meaning this bug is not
  DEV-specific; it will hit prod on every future deploy that touches any
  file, exactly as it did here.

**Still open.** Needs `umask 022` set explicitly before the deploy
tool's checkout/write step, or a `chmod -R go+r` pass on the working
tree as a safety net immediately after. Either the missing-force-flag
gap or the permissions bug alone would be worth fixing before actual
Step 3 (auto-save) starts; both existing at once is worse.

## 5. A second unauthorized main + prod update — different mechanism than Step 1's

`atrium-release-status` showed `MAIN actual` and `PROD actual` both
already at `aa005622...`, with `MAIN recorded` and `PROD recorded` both
blank — the same signature as Step 1's bypass (real change, nothing
recorded), but this time reaching prod as well as main, and **without**
anyone running `atrium-main-approve`, `atrium-main-push`,
`atrium-prod-approve`, or giving an explicit go-ahead.

**This one was not a Hermes bypass.** `git reflog` on `/srv/atrium`
showed the tool's own legitimate signature (`pull origin main:
Fast-forward`) for every real prior prod deploy going back to the
original clone — and then, immediately after, three raw
`checkout: moving from X to Y` entries walking straight through
`efe8606` → `c9257e1` → `aa005622`. That's the signature of manual
`git checkout <sha>` commands run directly in a shell — timed almost
exactly against the DEV step-back/step-forward permissions test from
§4. Best working explanation: a wrong-directory slip, commands meant
for `/srv/atrium-dev` landing in `/srv/atrium` instead — an easy mistake
late in a long session with a lot of `cd`-ing between two
similarly-named paths.

**Resolution differed from Step 1's `efe8606` incident on purpose.**
`efe8606` was an actual unreviewed merge commit and needed a real
re-review before its state could be honestly recorded. `aa005622` was
never in question on the content side — it's the same SHA that went
through the full brief → implement → dual review → revision → dual
APPROVE → DEV deploy → finalizer pipeline for real. Only the git-level
promotion to main/prod happened outside the gated tools. So the fix
here was to reconcile the tracker to match a reality that was already
legitimate:
```
atrium-release-state set-main aa005622c3da3fecb3806467d9d8dd62554200f4
atrium-release-state set-prod aa005622c3da3fecb3806467d9d8dd62554200f4
```
No re-review needed, no force-push, no history rewrite. The question is
never "did a tool get bypassed," it's "was the actual content ever
properly reviewed" — here it genuinely was.

## 6. A long-standing hostname/certificate mismatch, mistaken for a live outage

After fixing prod's file permissions, `https://5-78-232-73.sslip.io/...`
(dashes) still failed — not with a 403 this time, but at the TLS
handshake itself (`TLS alert, internal error`), no HTTP response at
all. This was initially treated as a possible active production outage
and investigated as one.

**It was never an outage.** Caddy's own certificate-renewal logs showed
prod's actual, currently-valid certificate is issued for
`5.78.232.73.sslip.io` — **dots**, not dashes. sslip.io supports both
formats as valid hostnames resolving to the same IP, but TLS/SNI and
Let's Encrypt treat them as two completely different names. DEV's real
certificate is for `dev.5-78-232-73.sslip.io` (dashes, confirmed working
all night) — but prod's was issued for the dotted form. Every reference
to the "prod URL" throughout this entire multi-day engagement —
including the original Sept 12 architecture passdown and every curl
command run tonight — used the dashed form. Confirmed directly:
`curl -v https://5.78.232.73.sslip.io/apps/client/src/app.js` returns a
clean `200` with a valid, unexpired cert and the correct, reviewed file
content.

**This is very likely a documentation error that predates this
project's Phase 2 work entirely**, not a regression from tonight.
Nothing in the automated health-check tooling anywhere in this project
was ever actually testing the documented public hostname over real
HTTPS — those checks almost certainly hit `localhost:3000` directly,
bypassing TLS and hostname matching entirely, which is exactly why this
was never caught until a real external client finally hit the
documented address for the first time.

**Fix, not urgent:** either add a matching Caddyfile site block and
certificate for the dashed hostname, or simply correct the canonical
prod URL everywhere it's written down. The dotted form
(`https://5.78.232.73.sslip.io`) is the one with a real certificate
today.

## 7. "No avatar when I click Load" — confirmed not a bug

Worth documenting so it doesn't get rediscovered as a false bug report.
`Load` and `Connect`/auto-connect are two unrelated, pre-existing
mechanisms: `Connect` opens a real WebSocket session (avatar, live
movement, other people). `Load` does a plain `fetch('/api/worlds/:id')`
and renders the *saved document* statically — no live session at all.
Avatar nodes have never been part of any saved document, for any world,
by design, since the start of the project. No avatar via `Load` is
correct for every world, home included.

## 8. The board's own phantom-reference checker caught a real mistake

The orchestrator task that kicked off review invented a sentinel ID
(`t_b5b82e2d`) that never existed on the board. The worker caught this
itself in real time, used the real sentinel (`t_d3c36df2`) instead, and
recorded the correction explicitly in its own completion metadata. The
board's diagnostic panel separately and automatically flagged the same
phantom reference after the fact. Worth knowing this checker exists and
trusting it — it's exactly the kind of structural safety net that would
have caught some of Steps 1–2's incidents faster if it had fired on
them.

## 9. Task labels are not ground truth either — the meta-lesson of this document

Worth naming directly, since it's the one lesson from tonight that
applies to *this document itself*: the orchestrator's own task titles
called this work "Step 3," and that label got repeated through several
turns of conversation and into an earlier draft of this passdown before
being caught and corrected. Every other lesson in both passdown
documents so far is about not trusting a SHA, a status report, or a
"done" claim without checking it against ground truth — this is the
same failure mode one level up, applied to *planning labels* instead of
*execution results*. A task's own title is exactly as unverified as a
task's own completion summary. Worth checking a step's name against the
actual addendum/design doc the same way every SHA tonight got checked
against actual git state.

## 10. What worked, worth keeping exactly as-is

- The deployer's restricted, no-host-shell boundary held firm through
  the entire force-fresh-deploy investigation — it correctly refused to
  delete files or SSH anywhere, forcing the one genuinely privileged
  action back to a human, exactly as designed.
- The review → revision → rereview cycle worked correctly and
  substantively this time: real `CHANGES_REQUIRED`, real fixes, real
  re-approval — no wiring bugs in this particular chain.
- Once real, ground-truth file permissions and timestamps were checked
  directly, every open question got resolved by evidence rather than
  argument — the umask bug, the main/prod reflog, and the hostname
  mismatch were each settled by one command, not by reasoning alone.

## 11. Standing open items going into actual Step 3 (auto-save)

1. **`atrium_deploy`'s umask bug** — confirmed twice (DEV and prod),
   still unfixed. Real risk to any future deploy, not hypothetical.
2. **`atrium_deploy`'s missing force/re-checkout path** — no way to
   force a genuine re-checkout when the target SHA already matches
   current HEAD; blocks routine verification, not just this case.
3. **Stage-transition reliability** — fourth occurrence of a pipeline
   stage failing to auto-advance without manual intervention. Needs the
   structural fix (kickoff wires the full chain up front), not another
   one-off patch.
4. **Prod hostname/cert mismatch** — cosmetic/documentation fix, not
   urgent, but worth closing so `https://5-78-232-73.sslip.io` either
   works or stops being referenced as if it does.
5. **Git commit attribution** — still unaddressed from the prior
   passdown: every commit shows `Josh` as author/committer regardless of
   who or what actually made it.
6. **Check step labels against the addendum before trusting them** —
   new this round; see §9.
