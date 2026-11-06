# Passdown 2026-11-05 (evening): `add-check` shipped to PROD (`cdfe88a8`)

This supersedes `Atrium-Passdown-2026-11-05-undo-hold-shipped.md` as the
starting point. Read this file first. That passdown's host, connector and
convention notes still hold, and so do its follow-ups (carried in §6).

**First instruction for the next session's Claude:**
1. Clone the repo and read this file. The next work is the richer `add`
   (§6 item 1): `devtasks/PREBRIEF-richer-add-copy.md`, DRAFT Rev 0.2.
2. **Use the `atrium-ops` connector for board, release, log and git state.**
   It is read-only. To push `devtasks/` to `main`, attach the repo with push
   access (`add_repo`, `joshmaurice/atrium`, access `push`) and clone to
   `/home/claude/atrium`.
3. **The release rule is unchanged:** from a round's DEV release merge until
   PROD is `COMPLETE`, push **nothing** to `main`, except a revision that
   supersedes a DEV the host hasn't accepted (undo-hold passdown §3.4). This
   round used that exception twice.
4. **Cost matters** (operator, 2026-11-05: about $70 of OpenRouter in a month,
   credits ran out mid-round). Prefer the cheaper path in §4.
5. **Give the operator host commands with no leading spaces,** and real paths,
   never placeholders like `<db>` (§3.6).

## 1. Where things stand
| What | State |
|---|---|
| Release | `COMPLETE`. DEV = MAIN = PROD = **`cdfe88a876cf3388a84de69aea6872407eb032c7`**: round 2.1's reviewed tip `d56444c0` plus `main`'s `devtasks/` notes. PROD restarted cleanly at 02:25:59 UTC (commons loaded, 28 nodes, no errors). PROD's `app.js` is `b601c8e710db` |
| The live defect | **Closed.** An anonymous visitor's malformed avatar `add` can no longer stop joins, stall the process, bloat every join, or store non-finite geometry; an owner can no longer save a world that can't be loaded |
| An older data-loss bug | **Also closed:** autosave could lose an edit made while a save was in flight (on PROD since autosave existed). §2 round 2 |
| Board | Clean apart from `add-check`'s leftovers: the review gate `t_d6c11601` (`blocked`, crashed when the credits ran out) and the sentinel `t_82771022` (`todo`). Archive both (§7) |
| Branches on GitHub | `workflow/add-check`, `claude/add-check-r2` and eleven `release/*` refs, plus `workflow/undo-hold` and `workflow/scripting-4d-1`. All can go (§7) |
| PROD survey | `p6` at `6980e24` (operator, 2026-11-05 14:26 PT): 23 worlds, none unreadable, nothing saved that the check refuses |

## 2. What shipped (three rounds)
**The contract:** `PREBRIEF-add-check.md` FINAL Rev 1.1 (base `25f6b083`),
carved out of `PREBRIEF-richer-add-copy.md` Rev 0.2 after two outside reviews
of its Rev 0.1 (`REVIEW-richer-add-copy-rev0.1-{claude,chatgpt}.md`). Then
`KICKOFF-add-check.md` and `REVISION-add-check-round-2.md` (§1–7 round 2, §8
round 2.1).

| Round | What | Who | Found by |
|---|---|---|---|
| 1 (`53764b76`) | `checkAddNode` + `add-spec.js` pinned by 42 vectors; the avatar budget; `translation` in K6; `format` pinned; [0, 1] ranges shared with `send`; autosave read-back and `WORLD_UNREADABLE`; Duplicate and Undo run the rule | DeepSeek (two runs: the first stopped after 504 s, not at the 120-minute cap it claimed), GLM review PASS | the pre-brief and its two reviews |
| 2 (`302654c8`) | **`__proto__` bypassed the 16 KiB extras budget** (900 KB accepted, broadcast and saved); **autosave lost an edit made during a save** (also on `8fc82bb5`); the checker relied on the schema; lengths after values; boundary vectors | Claude, fast lane | the outside code review of round 1 (`REVIEW-add-check-code-r1-chatgpt.md`), every finding reproduced by Claude first |
| 2.1 (`d56444c0`) | **Round 2's autosave fix let a flush wait forever** (73 failing attempts in 1.5 s, still pending); `stop()` during a flush **spun the process**; a stopped save could still write | Claude, fast lane | the outside review of round 2 (`REVIEW-add-check-code-r2-chatgpt.md`), and Claude while reproducing it; follow-up review APPROVE WITH NITS |

**Checks before PROD:** 3,864 tests at `d56444c0` (each server file alone),
all passing; Claude's probes (`p3`, `p4`, `p7`, `review-q/q2`, and three of
its own) through the real handler; the browser regression set `h1`–`h6`,
`c2` and 4b-1's `c1` (Duplicate, Undo, Redo before and after a reload) on
round 1; the operator's DEV acceptance, including closing the last tab within
a second of an edit and reopening the world.

## 3. Lessons
### 3.1 The GLM review passed two real bugs
- Round 1's GLM review was thorough (all proofs reproduced, line-by-line
  comparison, its own tests) and still passed the `__proto__` bypass and the
  autosave race. **Both outside code reviews were worth more than their
  cost** (a ChatGPT chat, no OpenRouter).
- **Shared vectors pin the two copies to each other, not to the truth:** both
  copies had the same `__proto__` bug, and every vector passed.

### 3.2 Claude's own fix introduced a worse bug
- Round 2's autosave fix chained follow-up saves into the promise a flush
  awaited. The outside review caught it; reproducing it found a spin that
  would have blocked the whole server on `stop()` mid-flush.
- **For concurrency fixes, test the failure paths too** (saves that keep
  failing, a stop mid-save), not only the race being fixed.

### 3.3 Outside reviewers can't clone
- All three ChatGPT reviews failed `git clone` on DNS and reviewed source
  through the GitHub connector. Their findings were still right, but none
  ran a test. **Claude reproduces every finding before acting on it.** The
  claude.ai reviewer of the pre-brief could clone and run.

### 3.4 Agent runs and credits
- The kickoff, brief, implementation (two runs) and review (three runs, two
  lost) ran on OpenRouter; the review gate crashed when the credits ran out.
- **Publish and DEV deploy were done from the host** instead (two commands,
  §4), skipping four agent cards. It worked first time.

### 3.5 The survey was worth running twice
- The first `p6` run missed some cases the check refuses (found by a fresh
  agent's check of the pre-brief). The rerun with the full counters is what
  let the round claim "nothing that works today stops working".

### 3.6 Session mechanics
- **Placeholders in host commands get pasted literally** (`sqlite3 <db>`
  failed). Look up the real paths (PROD's database is
  `/var/lib/atrium/atrium.db`) and use a throwaway clone (`/root/tmp-survey`).
- **`better-sqlite3` in a scripts-off install:** `pnpm rebuild` silently does
  nothing and the prebuilt download is blocked. This works:
  `cd node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3 && node /opt/node22/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/opt/node22`.
  `p6` now falls back to Node's built-in `node:sqlite` anyway.
- **A claude.ai review can be read from the past-chats tools** when its share
  link can't be fetched (`conversation_search`, then `read_conversation`).

## 4. The cheaper round (operator, 2026-11-05: "change our approach for future rounds")
Proposed for the next round; the operator decides.
- **Publish and DEV deploy from the host,** not as agent cards:
  `atrium-deploy-gate "publish <sha> workflow/<slug>"` (only for a branch
  that isn't on GitHub yet) and `atrium-deploy-gate "dev <sha>"`. Then
  `atrium-main-approve <sha> && atrium-deploy-gate "main <sha>"`, and
  `atrium-prod-approve <sha> && atrium-deploy-gate "prod <sha>"`, guarded on
  `atrium-release-status`. No finalizer or acceptance-gate cards.
- **Small or already-reproduced fixes go in the fast lane** (Claude
  implements, pushes `claude/<slug>`), with one outside review instead of a
  GLM card. Rounds 2 and 2.1 cost no OpenRouter credit.
- **Keep the GLM brief and implementation for large rounds**, and size the
  reviewer's duties to the round; `max-retries 1` on review cards.
- **Outside reviews through ChatGPT or claude.ai,** pinned to a SHA, are the
  best value found so far (§3.1).

## 5. Harness and probes added
| File | What it does |
|---|---|
| `devtasks/spike-richer-add/p6-db-survey.mjs` | the PROD survey, now with every case `add-check` refuses, UTF-8 sizes, and the `node:sqlite` fallback |
| `devtasks/spike-richer-add/p7-float32-extensions.mjs` | Float32 overflow and `node.extensions` through the real handler |
| `devtasks/spike-richer-add/review-q/q1`, `q2` | the claude.ai reviewer's probes |
| `packages/server/test/add-check.test.js`, `add-node-vectors.test.js`, `add-node-boundaries.test.js` | the round's server tests (port 0) |

## 6. Follow-ups
1. **Next: the richer `add`.** `PREBRIEF-richer-add-copy.md` DRAFT Rev 0.2.
   Its §4 now points at `PREBRIEF-add-check.md`; `richer-add` widens that
   file's A1–A4 and keeps A5. Open: **RA-L2** (labels dropped, Claude) vs (a)
   (GR), **RA-L3** (own materials, Claude) vs (b) (GR; PROD has no shared
   materials today), **RA-L6**, and CP-L1–CP-L7 for the copy round. PROD's
   mix: 18 top-level objects would become copyable (named materials), 9 need
   the subtree `add`.
2. **A hidden host tab stops behaviours** (operator, 2026-11-05): the runner
   ticks on `requestAnimationFrame` (`PREBRIEF-scripting-4d.md` P8), so
   switching tabs freezes the spinner for everyone. Options: hand the host
   role to a visible owner tab (Claude's pick), a timer tick (partial), or
   step 6's worker. Needs a short pre-brief.
3. **Two behaviour-driven objects are choppy** (carried, undo-hold passdown
   §6 item 6): one shared 20-a-second send queue per world. Claude's pick:
   renderer smoothing. It and item 2 could share one small client round.
4. **`add-check`'s non-blocking nits** (`REVIEW-add-check-code-r2.1-chatgpt.md`): the stopped-save test still waits a fixed 50 ms
   (await the `flushWorld` promise instead); `within()` leaves its timer
   running. Test-only.
5. **A registry race, older than this round** (round 2.1 review): a new
   session that joins while `world-registry.js` L593–607 awaits the teardown
   flush isn't re-checked before the host closes. Not reproduced.
6. **Carried from earlier passdowns:** the Behaviour panel's "Custom graph"
   (no file name or targets); the hold names one node; 4d-1's three items;
   `c2.py`'s timing flake.
7. **The kickoff template** could drop the release-chain cards in favour of
   §4's host commands, if the operator adopts it.

## 7. Cleanup (operator, on the host)
```bash
hermes kanban --board atrium archive t_d6c11601
hermes kanban --board atrium archive t_82771022
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete workflow/add-check claude/add-check-r2 release/53764b767531 release/302654c8bb99 release/d56444c0fec6
```
The last line is optional. The other `release/*` refs and `workflow/undo-hold`
and `workflow/scripting-4d-1` can go the same way.
