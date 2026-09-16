# Atrium Phase 2 — Checkpoint v3

**Checkpoint date:** 2026-09-16 (Pacific time)
**Purpose:** Concise, current "front page" for where Phase 2 actually
stands. Supersedes `Atrium-Phase2-Step1-checkpoint-v2-2026-09-12.md` in
that role. The other three original docs (Architecture & Security,
Orchestration & Workflow, Operations & Lessons — all dated 2026-09-12)
are still accurate as background and haven't changed. For the incident
detail behind everything summarized here, see the two passdown docs
listed at the bottom.

## Progress against the actual 6-step plan

Per `ADDENDUM-user-accounts-phase2.md`'s own sequencing — not per any
Kanban task's own label, which has been wrong before (see below):

1. **Multi-world hosting + owner-only mutation gate** — ✅ Complete, on
   PROD. Final SHA `efe86067cc775d6284f4e87d57372eaca36a3922`.
2. **Home world auto-create + auto-load on login** — ✅ Complete, on
   PROD. Final SHA `c9257e162d01be81f325b239557a79c7734aba25`. Plus a
   necessary follow-up completing what this step's own text promised
   (the client never actually initiated a connection after login,
   despite "auto-load" being in scope) — ✅ Complete, on PROD. Final SHA
   `aa005622c3da3fecb3806467d9d8dd62554200f4`. **This follow-up was
   mislabeled "Step 3" on the Kanban board and in earlier conversation —
   it is not.**
3. **Auto-save** (debounce + disconnect-flush + periodic safety net) —
   ❌ Not started. This is the real next step.
4. **Visibility toggle + public routing** — ❌ Not started.
5. **The commons** — ❌ Not started.
6. **Teleporter placement** — ❌ Not started.

## Current actual release state

As of last check: `atrium-release-status` reports `STATE: COMPLETE`,
with DEV, MAIN, and PROD all at `aa005622c3da3fecb3806467d9d8dd62554200f4`,
both `_actual` and `_recorded` fields agreeing, both health checks
passing. Verified independently against GitHub and against the real
production hostname, not taken from the tool's report alone.

**Caveat worth carrying forward:** "health: healthy" reflects SHA
agreement plus whatever internal check the tool runs (almost certainly
an API endpoint, not a real page load) — it never caught the file-403
bug covered in the client-auto-connect passdown, and wouldn't catch a
similar static-asset problem in the future either. Don't read "healthy"
as "a real browser can actually use the site."

## Two decisions made but not yet implemented

Both currently live only as Kanban task descriptions — worth having
here too given several tasks got duplicated, orphaned, or superseded
this week.

**Logout should make you anonymous, not disconnect you.** Logging out
while in the public world: stay connected, become anonymous (standard
generated guest name). Logging out while in a private/home world: move
to the public world, anonymous. Implementation approach agreed:
client-side disconnect + reconnect with no auth cookie, reusing the
existing reconnect path (an anonymous reconnect to `/home/<userId>/home`
is naturally refused by admission, handling the private-world case for
free) — **plus** a required server-side backstop: `POST /api/auth/logout`
should close any *other* live sessions bound to that `userId` via the
world registry, since a client-side fix alone doesn't cover other tabs
or a non-cooperating client. Not yet implemented. Deferred deliberately
until after the client-auto-connect fix landed on PROD, which it now
has — this is unblocked.

**`PUT /api/worlds/:id` serializes the wrong host.** Under the new
multi-world registry, Phase 1's manual-save endpoint always serializes
the *default* world, never the world actually being saved. Latent today
— nothing calls it against a home world yet — but it must be fixed as
part of Step 3 (auto-save) infrastructure specifically, not left in
place and rediscovered later as a live bug.

## Standing open items (detail in the passdown docs below)

1. `atrium_deploy` writes files as `0600` instead of `0644` (confirmed
   twice — DEV and PROD both), breaking static-asset serving until
   manually `chmod`'d. Needs `umask 022` before checkout, or a
   post-checkout `chmod -R go+r` safety net. **Unfixed.**
2. `atrium_deploy` has no way to force a genuine re-checkout when the
   target SHA already matches current HEAD — blocks routine
   verification after any fix to the tool itself. **Unfixed.**
3. Pipeline stages have failed to auto-advance without manual
   intervention four separate times (under- and over-triggering both
   observed). Needs the orchestrator's kickoff to wire the entire
   pipeline's tasks as real Kanban dependencies up front, rather than
   creating each next stage reactively after noticing a completion.
   **Unfixed.**
4. `https://5-78-232-73.sslip.io` (dashes) has no valid certificate;
   `https://5.78.232.73.sslip.io` (dots) does. Long-standing, not a
   regression — every doc including this project's own originals used
   the dashed form. Low urgency; fix by adding a cert for the dashed
   form or correcting every reference to the dotted one.
5. Every commit in the shared checkout shows `Josh` as author/committer
   regardless of what actually produced it — a real gap for any future
   investigation that needs to know who/what did something.
6. Check a task's own step-number label against the actual addendum
   before trusting it — new this round, see the client-auto-connect
   passdown §9.

## Credential state (carried forward from the Step 1/2 passdown, worth reconfirming before Step 3)

Host root (`/root/.gitconfig`, `/root/.git-credentials`) should hold a
narrowly-scoped, short-lived personal token backing the
`atrium-main-approve`/`atrium-main-push` bridge — nothing should exist
under any `/root/.hermes/sandboxes/.../home/` path. Worth a fresh
`git config --list --show-origin | grep -i credential` check before
relying on it again, rather than assuming last time's setup is still
exactly as left.

## Required release workflow

Unchanged from the original architecture/workflow docs — dual review,
exact-SHA gates, human DEV acceptance, restricted main/prod bridges.
Two things learned in practice worth adding on top of that process, not
replacing it:
- If a deploy tool skips a step because the target SHA already matches
  current HEAD and you need to force a genuine re-run, deploying to a
  different known-good SHA first and back is a safe workaround until
  item 2 above is actually fixed.
- Confirm state changes independently (`git ls-remote`, `git diff
  --stat`, `curl`, `atrium-release-status`) rather than trusting any
  task's self-report — this has caught a real problem essentially every
  time it's been done this week.

## Companion files

- `Atrium-Hermes-Architecture-Security-Passdown-2026-09-12.md`
- `Atrium-Orchestration-Release-Workflow-Passdown-2026-09-12.md`
- `Atrium-Operations-Lessons-Passdown-2026-09-12.md`
- `Atrium-Passdown-2026-09-15-release-gate-incidents.md` (credential
  exposure, fast-forward bypass, sentinel/orchestration bugs)
- `Atrium-Passdown-2026-09-16-client-autoconnect-permissions-hostname.md`
  (deploy permissions bug, unauthorized main/prod update, hostname
  mismatch, the step-mislabeling itself)
- `Atrium-Phase2-Step1-checkpoint-v2-2026-09-12.md` (superseded by this
  document as the front page; still useful as a historical snapshot of
  where Step 1 stood mid-flight)
