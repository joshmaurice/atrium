# Atrium Passdown — 2026-10-19 (late) — Copying objects across worlds: decisions; next is step 3

**Read after** `devtasks/Atrium-Passdown-2026-10-19-edit-polish-2.md` (same
day, earlier). Nothing was built or deployed after it: release state is
still COMPLETE at `229c4a87`. This file records an operator discussion
(2026-10-19, ~21:50–22:48 PT) and hands off to **Phase 3 step 3**, which the
next session starts.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first (this file, then the
   edit-polish-2 passdown).
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.
3. Then §3 below: start step 3's pre-brief.

## 1. Copying objects from any world (a change to the phase 3 design)

`docs/DESIGN-phase3-placement-scripting.md` §6 deferred "copy this object
while visiting someone else's world" behind a creator-controlled `copyable`
flag. The operator wants it, without the flag. §6 is updated to point here.

### Decisions (operator, 2026-10-19)
- **C1 — Copy from any world you can see.** A Copy action while visiting
  (select without editing), and Paste in Edit mode in your own world through
  the normal `add` path, so a paste is undoable like any add. Mostly client
  work: visitors already hold every object (the `som-dump`), and Duplicate
  already builds an `add` from a node as it is now (`prepareDuplicate`).
- **C2 — No `copyable` flag and no opt-out.** Everything a visitor receives
  is already in their browser: the world document, every model file they
  render (step 3), and readable scripts (design §10 Q6). A flag, even an
  opt-out, would suggest a protection that doesn't exist. Instead, **say it
  plainly** where it matters (making a world public; the Edit panel or
  help): visitors can see and copy anything in a world.
- **C3 — The real protection is visibility.** Today a private world admits
  **only its owner** (world-visibility round); there's no way to let anyone
  else in. A guest list would be a new feature, and its guests could copy
  too.
- **C4 — Attribution: the original plus the most recent source** (option 2
  of three).
  - `origin`: set at an object's **first** copy and carried **unchanged**
    through every later copy: creator, world, date.
  - `copiedFrom`: the world it was copied from **this time**, overwritten by
    each copy.
  - Store **user ids**, and show current names (usernames may change).
  - An object made from scratch (a palette cube) has no `origin` until its
    first copy; that copy records the source world's **owner** as creator.
  - It lives in extras, so anyone determined can edit or strip it, as with
    copying itself. **The UI presents it as credit, not proof.**
  - Not taken: most recent only (loses the maker after one hop); the full
    chain (grows with every copy, says more than needed).
  - Later, optionally: a **licence label** (CC0, CC BY, "please ask"),
    shown as information to people copying, never as a lock.

### Open, for the copy step's own pre-brief
- The exact shape and key names (e.g. `extras.atrium.origin`,
  `extras.atrium.copiedFrom`), and how they pass the client's restore and
  duplicate rules (`edit-duplicate.js` `atriumProblem`) and the server's
  `add` handling of `extras.atrium` (`session.js`, the S2 guards). Probe
  both.
- Whether the server stamps anything (it can't verify a client's claim of
  where an object came from).
- Where the clipboard lives (in memory or `localStorage`), where a paste
  lands (the palette's spot ahead of you is the obvious default), and
  copying several objects at once.
- Behaviors (after step 4) arrive **disabled**, as step 7's import does.
- What copies at all: Duplicate's limits apply until the richer `add`
  (10-18 passdown §5.1 item 1): today
  primitives and pads copy; groups, and meshes with named materials, don't.

### Where it fits (proposal; the order is the operator's call)
Step 3 (models by URL) → the **richer `add`** (named materials, extras,
UVs and the rest, so most single objects copy) → **the copy step** → step 4
onward. Groups need the separate subtree `add` (design §7 item 7). Step 7
then keeps file export (Atrium package, portable glTF), import by URL or
file, id remapping and the behavior review.

## 2. Corrections from the discussion
- Earlier in this session Claude said a private world admits "the people the
  owner lets in". **Wrong:** only the owner (C3).
- Models by URL (step 3) are **`https://` or server-relative paths, never
  `wss://`**. `wss://` addresses worlds (teleporter destinations); models
  are files each visitor's browser fetches (design §4.3, §10 Q5).

## 3. Next: Phase 3 step 3
**Scope** (design §9 row 3): models by URL (`extras.atrium.model`: a full
loader, live resolution, download and decoded limits, pinned or mutable);
the starter library (CC0, pinned); the sky setting. Server side: an
optional URL-scheme check, and static hosting of `assets/library` (Caddy,
host work).

**Read first:** design §4.3 (models), §4.4 (starter library), §9 row 3,
§10 decisions Q4 and Q5; the 10-18 passdown §5.1 item 1 (the richer `add`
is **not** needed by step 3: a placed model is a node plus a URL).

**Notes from this discussion for that pre-brief:**
- Copies (C1) will carry the model's URL unchanged, so hot-linking and
  licences follow every copy. Pinned `sha256` and `bounds` travel too.
- Library items have known licences. Placing one could set C4's `origin`
  to the library item, so credit starts at the library. Optional; decide in
  the pre-brief.
- The visitor-privacy note in design §4.3 (a model's host sees visitors'
  IPs) belongs in the same plain-language place as C2's "visitors can copy".

**Effort:** step 3's pre-brief is larger than the polish rounds (loader,
limits, library hosting, sky, and some host work). Expect to propose high
effort for the probing, and say so loudly first. Lane: probably the full
pipeline for the client and server parts, with the Caddy and library hosting
as operator host steps.

**Still open from earlier passdowns:** edit-polish-2 §5.1 (key guard,
form-state tests, stale form error, optional spawn hint); Pass B. (The host
GitHub token was already **replaced**, 10-18 passdown §1; the 2026-10-29
expiry in older files and the Pass B pre-brief no longer applies.)
