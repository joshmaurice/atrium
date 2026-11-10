# Release package: `grouping`

- **What:** the round on `claude/grouping`, commits `de33cf8..8d4ff38`, plus
  later commits that change `devtasks/` only.
- **Status:**
  - the code check, the outside review and all suites are done
    (`HANDOFF-grouping.md` §5, §7 and §8);
  - it waits for the operator at a laptop.
- **State checked 2026-11-10, 08:35 PT** (`release_status`):
  - `COMPLETE`;
  - DEV and PROD on `331e4aed`, both healthy;
  - deploy lock free;
  - `main` (`172b816d`) is already in the branch.

## 1. Before the deploy
1. Open one DEV tab and leave it as it is: step 7 needs a tab from before the
   deploy.
2. Ask Claude for the DEV command. Claude checks the branch tip, and that
   nothing outside `devtasks/` changed since `8d4ff38`
   (`git diff 8d4ff38 <tip> -- . ':!devtasks'` is empty), then gives:
   ```bash
   atrium-deploy-gate "dev <the 40-character tip SHA>"
   ```
3. After the deploy, Claude checks DEV's actual SHA with `release_status`
   before the acceptance counts.

**DEV restarts.** Every other open tab must be hard-reloaded: GR5, the stale
tab refusal.

## 2. DEV acceptance (pre-brief §5)
Do these in Edit mode, as the owner.

1. **Group.** Hard reload. Select a cube and press **Group**.
   - The cube doesn't move.
   - The panel selects `group-01`, and the breadcrumb is empty (top level).
2. **Move to.** Select another cube, and in **Move to…** pick `group-01`.
   - It doesn't move.
   - Click it: `group-01` is selected, with both cubes outlined as one.
   - Double-click it: the cube is selected, and the breadcrumb reads
     `group-01 › <cube>`.
3. **Drag the group.** With the group selected, drag the move handle a few
   centimetres on screen. Both cubes move together.
4. **Undo three times:** the drag, then the Move to, then the Group. Each
   goes back exactly where it was.
5. **Redo three times, then Ungroup.** Select `group-01` and press
   **Ungroup**.
   - Both cubes stay where they are, and `group-01` is gone.
   - Undo brings it back with both inside.
5a. **Empty groups.** After step 5's Undo, both cubes are inside `group-01`.
   1. Select one cube and choose **Move to… → Top level**, then do the same
      for the other.
      - Both stay where they are.
      - **Empty groups (1)** appears.
   2. Pick `group-01` there.
      - The handles appear at its origin.
      - The Name field reads `group-01`.
   3. Select a cube and choose **Move to… → group-01**. The Empty groups row
      disappears.
   4. Move that cube to the top level again.
   5. Pick `group-01` in Empty groups and press **Delete**.
      - It is gone.
      - Undo brings it back.
6. **A visitor watches.** In a second tab (a visitor), watch steps 1–5.
   Nothing jumps.
7. **The tab from before the deploy.** The deploy has already disconnected
   it.
   - Press **Connect** in it without reloading. It says "Connect failed:
     PERMISSION_DENIED: this page is older than the server: reload it".
   - Reload it: it connects, and its edits work.

Then MAIN and PROD (§3), then step 8.

8. **PROD.** On a scratch cube, repeat steps 1, 2 and 5.

## 3. MAIN and PROD (after the acceptance)
Claude gives these with the deployed SHA filled in, after checking
`git diff <reviewed tip> <DEV SHA> -- . ':!devtasks'` is empty (the DEV gate
may merge `main`'s `devtasks/`):
```bash
atrium-main-approve <SHA> && atrium-deploy-gate "main <SHA>"
```
Once MAIN has finished:
```bash
atrium-prod-approve <SHA> && atrium-deploy-gate "prod <SHA>"
```
**Never push to `main` between the DEV release merge and PROD `COMPLETE`.**

## 4. Release notes
**New in the Edit panel (the world's owner):**
- **Group:** puts the selected object in a new group, in place.
- **Ungroup:** takes a group apart and keeps every part where it is.
- **Move to…:** moves an object into a group, or to the top level, in place.
- **Empty groups:** a dropdown that selects a group with nothing in it.
  - A group is never deleted because it's empty.
  - To delete one, pick it there and press Delete.

Every action is one Undo entry, and Undo puts back the exact values.

**Unreloaded tabs:**
- A tab opened before this deploy is **refused at Connect** with "Connect
  failed: PERMISSION_DENIED: this page is older than the server: reload it".
- It can't edit, watch or host behaviours until it reloads.

**Bounds:**
- A group stays within the copy limits: 256 objects, 8 generations, 1,024
  primitives.
- An action whose Undo would break a limit asks first ("This can’t be undone:
  the group would be too large to copy").

**Not offered:**
- a model as a group;
- a part of a model moved out of it;
- a move that would change which behaviours may move an object (GR-L10).

**Stated limits:**
- **Unjudged pages (GR-L3):**
  - An unreloaded SOM Inspector tab isn't judged, since it declares neither
    capability.
  - An unreloaded page that isn't judged loses an ungrouped group's parts from
    its view until it reloads.
- **Behaviours (GR-L10):**
  - A behaviour's writes are local values, so after a Group they apply inside
    the group.
  - A custom graph that writes an object's transform makes that object's
    Group entry "changed elsewhere". The five templates write no transform.
- **r3's race:** a transform already in flight when another tab regroups the
  object lands in the new frame.

**Fixed along the way:**
- **f2:** an Undo of a pending Delete restores the object under its current
  parent.
- **Model form:** its Save now waits while an edit is in flight.

**Rollback:** to `331e4aed`. Every world loads as saved, since no stored data
changed shape. The old server refuses `parent` again.
