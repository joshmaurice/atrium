# Passdown 2026-11-06 (night): `copy-objects` shipped to PROD (`42aa56ff`)

This supersedes `Atrium-Passdown-2026-11-06-copy-objects-prebrief-final.md` as
the starting point. Read this file first. The host, connector and convention
notes, lessons and cheap-round recipe of `Atrium-Passdown-2026-11-06-richer-add-shipped.md`
(§3, §4) still hold; this file adds to them.

**First instruction for the next session's Claude:**
1. Clone the repo (`add_repo` `joshmaurice/atrium` with access `push`, clone to
   `/home/claude/atrium`) and read this file.
2. **The next round is the subtree `add`** (PROD's 9 objects with children,
   §5 item 1): it needs a pre-brief first, as every round does.
3. **Use the `atrium-ops` connector** for board, release, log and git state.
   It is read-only. **Check DEV's actual SHA with `release_status` before
   reading an acceptance as done** (§3.4).
4. The release rule, cost rule, host-command rule (no leading spaces, real
   paths) and the review-SHA rule are unchanged.

## 1. Where things stand
| | |
|---|---|
| PROD, MAIN, DEV | **`42aa56ffac68c9b1e23e943967c7d5ad7ca8a4cd`**, state `COMPLETE` (2026-11-06, 21:30 PT). PROD serves the same `app.js` as DEV (`5e73e7a5b148`) |
| The round | `copy-objects`: Inspect for visitors, Copy, and Paste into a world you own, with a claimed credit (`origin`, `copiedFrom`), behaviours isolated across worlds (K7), server-relative URLs resolved (K8), and **K0: the 1 MiB message cap on PROD's path** |
| The contract | `devtasks/PREBRIEF-copy-objects.md` FINAL Rev 2, **Rev 2.1** for K2's `address` row (the operator, after both code reviews) |
| The record | `devtasks/HANDOFF-copy-objects.md` (commits, tests, proofs, departures §4, the fresh check §7, the outside review §8, the post-review addition §9) |
| Reviews | the fresh-agent check (no must-fix; all findings taken); ChatGPT, `devtasks/REVIEW-copy-objects-code-chatgpt.md`: **APPROVE WITH NITS** of `2971a440` (source only: its clone failed on DNS again); N1 and N2 taken |
| Tests | 64 suites, **4,223 passing, 0 failing, 1 named skip** (4,046 at `ace29de`); the client suite with the post-review row, 1,576 passing |
| The DEV acceptance | all of the pre-brief's §5 passed, on `a3f457c4` then `42aa56ff` (the Credit row) |

### 1.1 Facts found this round
- **Caddy caps no WebSocket frame.** `/etc/caddy/Caddyfile` has no
  `request_body`; the probe (`devtasks/spike-copy-objects/caddy-frame-probe.mjs`,
  run on the host against `wss://dev.ewwb.dev/apps/client`) saw a 1.2 MiB frame
  reach Atrium. Until `42aa56ff`, PROD accepted any visitor's message up to
  100 MiB. Now 1 MiB everywhere (K0). The probe tells the two cases apart
  (checked against a capped and an uncapped server) and can be rerun.
- **Both commons have an owner, `commonskeeper`** (DEV and PROD). A paste from
  the commons is credited "Made by commonskeeper, it says".
- **PROD's `p6` survey at `42aa56ff`:** 24 worlds, 455 top-level objects
  (445 / 9 children / 1 non-unit rotation, as before); **no object already
  carries a credit**; 4 behaviours (2 self-only, 2 with one foreign reference
  each; 3 custom graphs, 1 template); 38 root-path model URLs, 14 absolute;
  47 path pad destinations, 41 `ws(s)://`. Inside PROD one origin: K8 changes
  nothing between PROD worlds.

## 2. What the round changed (for the next pre-brief's author)
- `hello` carries `world: { id, owner?: { id, name? } }`; the client keeps it
  as `client.world`, checked field by field.
- `extras.atrium.origin` and `extras.atrium.copiedFrom` exist, checked by form
  on the server and by Duplicate (`creditProblem`, both copies, one vectors
  file `tests/fixtures/credit-vectors.json`). `send` can't write them.
- `apps/client/src/copy-paste.js` is the pure Copy/Paste module; `app.js`
  holds the clipboard (memory only), Inspect (`modes.inspect`), the Copy and
  Paste buttons, the paste's own answer branch, and a **Credit row in the Edit
  panel** (post-review).
- `edit-modes.js` has two modes now (Edit, Inspect), exclusive.
- `copiedFrom.refs` records, for a behaviour pasted into another world, which
  fresh id stood for which of the source's objects: the input a future
  rebinding UI needs.

## 3. Lessons
1. **Trace every acceptance step to the screen that shows it.** The pre-brief
   put the credit only in Inspect, which an owner is never offered; its own DEV
   step 2 ("the crate appears with a credit naming the commons' owner") had no
   place to look. The stored credit was right; the display was missing. Found
   only at DEV. A pre-brief's acceptance step that names something the user
   sees should name the panel too.
2. **A proof has to reach the final effect.** The hostile tests at first
   passed for the wrong reason: the runner's 10 m click rule needs a local
   avatar, and with none every `select` stopped at `no-avatar`, so "the door
   was not written" proved nothing. Found by running (p1) with the engine
   assertion removed and seeing the door NOT written under the bad rule. Now
   the host tab has an avatar, `select` must return `not-running`, and under
   the bad rule the door is hidden on the server.
3. **Test the deployment's own shape.** Two servers on two ports are two
   origins; PROD's hostile world is on the SAME server. The fresh check showed
   that making "same world" ignore the world ids broke only an unrelated test.
   Now a one-server e2e test routes two worlds by path.
4. **A redeploy the operator thought ran hadn't.** After `42aa56ff`'s gate
   command DEV was still `a3f457c4` (the ops tool's `release_status`). Read the
   actual DEV SHA before accepting.
5. **The outside reviewer still can't clone** ("Could not resolve host:
   github.com"): its code review is source only. The fresh agent's runs, its
   200,000-credit differential fuzz and the proofs are the executed checks.
6. **A guard's false positive is fixed in the guard, narrowly.**
   `import-guard.test.js` matched `buildDescriptor` as an object key and in a
   comment; it now skips both, nothing else.

## 4. Release notes
- No `package.json` or lockfile change; no stored data to migrate; a rollback
  to `3fcc296c` stores nothing to undo (pasted objects' credits stay, as
  unknown-to-it `extras.atrium` keys, which it doesn't check).
- The DEV gate did not merge `main`'s `devtasks/` this time: DEV, MAIN and
  PROD are the branch tip exactly (MAIN fast-forwarded `ace29de..42aa56f`).

## 5. Follow-ups
1. **Next: the subtree `add`**, the next placement round (RA-L6 (a)): PROD's 9
   objects with children can't be duplicated, copied or undone.
2. **From this round:**
   - a rebinding UI for a pasted custom graph's references (`copiedFrom.refs`
     is its input); PROD has 2 behaviours with a foreign reference today;
   - several objects at once; a clipboard that survives a reload;
   - the client's missing animation check in `atriumProblem`;
   - healing a malformed saved credit at load; any future import must stamp
     fresh ids (K10);
   - the object name in Inspect and Edit is shown as stored: a name with a
     text-direction character can still reorder its own line (pre-existing;
     `shownText` in `copy-paste.js` is the tool, if wanted);
   - a ref's `name` over 64 characters is dropped from the record (K2's form);
   - Inspect turns off at every `world:loaded`, as Edit does.
3. **Carried from the prebrief-final passdown §6:** `richer-add`'s nits N1 and
   N2; the audit items (node `extras` finiteness, `send`'s cutoff on non-MASK,
   a per-world resource budget); `initDocumentView` passing the renderer as
   the document; PROD's one object with a non-unit rotation; and its carried
   list (the hidden host tab, choppy behaviour objects, `add-check`'s test
   nits, the registry race at teardown, "Custom graph", 4d-1's three items,
   `c2.py`'s flake, the kickoff template).

## 6. Cleanup (operator, on the host; carried items only if not yet done)
```bash
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/copy-objects
hermes kanban --board atrium archive t_d6c11601
hermes kanban --board atrium archive t_82771022
git -C /root/.hermes/sandboxes/docker/default/workspace/atrium push origin --delete claude/richer-add release/4b3393db219d
```
The kanban lines only if those cards are still there. The other `release/*`
refs (`2f28f030ec72`, `3cfeeed9a8bf`, `4f66f93b7f8b`, `769825ce3781`,
`85669db0f8a9`, `a096cf3f8fcf`, `e536913011cc`, `fe4dcbb34ed7`) and
`workflow/undo-hold` and `workflow/scripting-4d-1` can go the same way.
