# Atrium Passdown — 2026-10-16 (late morning) — Phase 3 step 1b-2: add palette, Delete, Duplicate (prototype lane)

**Predecessor:** `devtasks/Atrium-Passdown-2026-10-16-server-cleanup.md` (the
same morning). Its host, connector and follow-up state still holds, except
where this file says otherwise.

**First instruction for the next session's Claude:**
1. Clone the repo and read `devtasks/`, newest first.
2. If the `atrium-ops` connector's tools are listed, use them for board,
   release, log and git state. It is read-only.

## 1. Status at handoff

| Item | State |
|---|---|
| Release | **COMPLETE.** PROD deploy `t_391cf11e` done (DB backed up, health ok, no restart); confirmed through the connector at 14:59 PT |
| DEV / MAIN / PROD | all at `68a5b2b41a56cb479358287f028661366eb00164` |
| Base | `455ac25` (`main` with the pre-brief uploaded); runtime code equal to the released `27486bdf` |
| Spec | `devtasks/PREBRIEF-edit-mode-ui-1b-2.md`, FINAL Rev 2 plus §12 implementation notes (§12.4: the reviews and fixes) |
| Branches | `claude/edit-mode-ui-1b-2` and `claude/prebrief-edit-mode-ui-1b-2`: for the operator to delete |
| Lane | prototype (J1): built in a Claude cloud session; GLM card; outside review by a separate Claude session; operator DEV acceptance in Firefox |

**Board:** GLM `t_17130829` (APPROVE, `01ef38f2`); GLM `t_c580b552`
(APPROVE, final `68a5b2b4`); PROD gate `t_0335fad8`; PROD deploy
`t_391cf11e`.

### 1.1 Timeline (PT)
08:21 round started · 08:45 pre-brief Rev 2 on `main` · ~10:15 branch at
`01ef38f` · 10:22 GLM approves · 10:35 outside review (APPROVE, two
should-fixes) · 10:48 fixes at `68a5b2b` · 10:56 DEV · 11:00–11:44 Firefox
acceptance · 11:47 MAIN and PROD. The build-to-PROD stretch was under
2 hours; acceptance was the longest single step, as in 1b-1.

## 2. What shipped

`apps/client` and `packages/renderer-three` only. No server, protocol, SOM
or `packages/client` change; the DEV deploy needed no restart.

- **Add palette** (N1): cube, plane, sphere, cylinder, ramp
  (`buildPrimitiveDescriptor` in renderer-three). Placed 2.5 m along the
  view's horizontal direction (right in ORBIT too), resting on y = 0, named
  `Cube`, `Cube 2`…; selected once the server accepts. One retry if another
  tab takes the name first.
- **Delete** (N2): confirms every delete, "and N objects inside it" for a
  group. Own deletes show no message; a lost two-tab race shows "This object
  was removed." After the dialog the client waits 50 ms and re-checks the
  node by identity before deleting by name (outside review S1).
- **Duplicate** (N3): lossless or refused. Nine rules, checked at click time
  from current values; a size check keeps every `add` under the 1 MiB cap
  (an oversized `add` would disconnect the owner with 1009). The button's
  hint is cheap; the click measures exactly (S2).
- **J8:** the view returns to the default camera when the active world
  camera's host is removed, from any tab, including a shared camera.

**Tests:** `apps/client` 294 → **388**; renderer-three 64 → **86**;
`packages/client` 169, interaction 9, som 224, protocol 71 unchanged. All
`fail 0`, `skipped 0`. 21 proofs of failure. A 48-check end-to-end script
(real server, two real clients) and a 48-check headless run of the real page.
Commands and breakdown: pre-brief §12.3.

## 3. How the round ran

1. **Pre-brief:** Rev 0 from probes against `4f798eb`; J2–J9 approved;
   one outside review (ChatGPT, 11 findings, two must-fix, all accepted) →
   Rev 2. Uploaded at `455ac25`.
2. **Build** in this session, a commit per step; pure modules first.
3. **GLM** on `01ef38f`: APPROVE. Its run was real (26 terminal calls; its
   proof results matched the build's in detail) but its contract judgment
   took ~20 s with no findings. Treat GLM as a check on counts and proofs.
4. **Outside review** (separate Claude session): APPROVE with S1 (a stale
   delete-by-name could remove another tab's newer same-named object) and
   S2 (the Duplicate hint rebuilt the whole copy on every refresh), plus
   nits. All fixed in `ccf789a`; 6 new proofs. **It earned its place again:
   S1 was a real, silent data-loss path one click from DEV step 5b.**
5. **GLM** on the final SHA, DEV deploy, acceptance, MAIN, PROD.

## 4. Findings

### 4.1 Spec correction: a double click adds two shapes (accepted as designed)
- N1 and §8 step 2 said "a double click makes one node". The guard only
  covers the moment the first add waits for the server; on DEV the server
  answers before the second click, so each click adds a shape.
- **Operator ruling:** keep it. Fast clicks adding several objects is
  useful. **Corrected N1: each click adds one shape; clicks while an add is
  unanswered are ignored.**
- The headless test fired both clicks in one task, so it couldn't see this.
  **Lesson: a UI timing claim needs real click timing in the test**
  (Playwright `dblclick`, or clicks with a delay), not two `click()` calls
  in one evaluate.

### 4.2 The proof script reverted uncommitted work
The proof runner restored each broken file with `git checkout --`. Run
before committing the outside-review fixes, it reverted them in two files.
They were re-applied from the session's context and committed; the script
now restores each file from the copy it read. **Lesson: commit before
running proofs, and restore from a saved copy, never from git.**

### 4.3 Headless harness lessons (for the next prototype round)
- A background tab gets no animation frames: bring a tab to the front
  before anything that depends on the view or the camera.
- The home world allows WALK and FLY only; ORBIT needs `_allowedModes`
  widened in the harness.
- The commons seed refuses a fixture whose buffer isn't a data URI: inline
  it first.
- A failed run leaves the server holding its port: kill it on exit.
- `pkill -f <pattern>` matches its own shell; find the PID through `/proc`.

### 4.4 Pre-brief status line
The copy uploaded at `455ac25` said "Revision 1" in its status line; the
content was Rev 2. Fixed on the branch, now on `main`.

### 4.5 Remove-by-name is the root of S1
The client mitigation closes the practical window, but `remove` still names
its target by name. Step 2 (undo) will meet the same identity problem; an
object id (design §4.9, step 4) is the real fix.

## 5. Follow-ups

### 5.1 From this round (small, a tweak round)
1. **Planes are invisible from below** (operator, DEV): one-sided, like all
   palette shapes. Don't make the material double-sided (Duplicate refuses
   it, since `add` can't carry the flag); build the plane with a back face
   in its geometry instead (renderer-three only, stays duplicable).
2. **Double-click behaviour:** none; kept by ruling (§4.1).
3. **E7 still holds:** a node whose name another node shares can't be
   selected, so it can't be deleted or duplicated in Edit mode.
4. **Duplicate of nested nodes** (J3's alternative: `addNode(descriptor,
   { parent })` in `packages/client`).
5. **Retire the teleporter delete mode** now that Edit mode deletes pads (J7).
6. **Keyboard shortcuts** for Delete / Duplicate, after undo exists (J9).
7. **Public read-only SOM geometry getters** to replace `selected._node`
   (J4).

### 5.2 Next in sequence
1. **Step 2: undo and redo**, on 1b-1's gesture records and 1b-2's
   structural requests (§4.5 applies).
2. **Host:** connector Pass B (gated on S22), PROD least-privilege, P10.

### 5.3 Carried
- **The GitHub PAT expires 2026-10-29.**
- The `file:///` security error after load (seen again on DEV today).
- `Cache-Control: no-cache` for `/apps` and `/packages` (10-16 §6.1 item 1):
  acceptance still depends on a hard reload and the marker check.
- Everything in the 10-16 server-cleanup passdown §6 not closed here.

## 6. Recipes

### 6.1 Is this tab running 1b-2? (browser console)
```js
!!document.getElementById('ep-palette')   // true at 68a5b2b4 or later
```

### 6.2 A group with one child, in front of you (browser console, owner)
Used for the "N objects inside" check; the earlier fixed-position snippet put
it out of view.
```js
(async () => {
  const R = await import('/packages/renderer-three/src/index.js')
  const c = atriumClient
  const errs = []; const onErr = (e) => errs.push(`${e.code}: ${e.message}`); c.on('error', onErr)
  const a = stage.avatar.localNode.translation, q = stage.avatar.localNode.rotation ?? [0, 0, 0, 1]
  const yaw = 2 * Math.atan2(q[1], q[3]), at = [a[0] - 3 * Math.sin(yaw), 0, a[2] - 3 * Math.cos(yaw)]
  const g = 'grp-test-' + Math.random().toString(36).slice(2, 6)
  c.addNode({ name: g, translation: at })
  await new Promise(r => setTimeout(r, 600))
  c._wsSend({ type: 'add', seq: ++c._sendSeq, parent: g,
    node: R.buildPrimitiveDescriptor({ kind: 'cube', name: g + '-cube', position: [0, 0, 0] }) })
  await new Promise(r => setTimeout(r, 600)); c.off('error', onErr)
  console.log('group:', !!c.som.getNodeByName(g), '| cube parent:', c.som.getNodeByName(g + '-cube')?.parent?.name, '| errors:', errs)
})()
```

### 6.3 The prototype lane, as run this round
1. Pre-brief → outside review → decisions → upload to `main`.
2. Branch `claude/<slug>` from the fresh `main`; build; push.
3. GLM card (tint §7.2: host fetch first; body file `scp`'d to `/root/`;
   worker-card requirements appended) **and** the outside-review session,
   in parallel.
4. Fix review findings on the branch; GLM on the final SHA.
5. DEV: `atrium-deploy-gate "dev $S"` (teleport-rearm §7.1).
6. Firefox acceptance (hard reload, marker check).
7. MAIN: `atrium-main-approve $S && atrium-main-push $S`; PROD: teleport-rearm
   §7.2's guarded block.
