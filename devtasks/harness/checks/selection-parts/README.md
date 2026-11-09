# selection-parts harness checks

`PREBRIEF-selection-parts.md` §5's browser checks, run on the published
commit (`devtasks/harness/setup.sh <sha>`, then `server.mjs`; see the
harness README). Every press gives Playwright a `click_count`: without it
`mouse.down()` sends `detail` 1, and no double-click is ever seen.

- `sp.py`: the helpers. The handle search (`point_over`) runs in the page: a
  synthetic `pointermove` on the canvas makes TransformControls set `axis`
  at once, and the scene ray says what is behind that point.
- `c1.py`: the lamp (`space.gltf`). Clicks, double-clicks on lamp-01's Y
  handle over the stand with 0, 1 and 2 px of jitter, a sibling click, a
  6 px second press (SP-L11), Escape ×3, a short press on a handle over the
  floor and over empty space (SP-L10), a real drag and a one-move drag
  (S-4), another tab's move during a short press (S-2).
- `c2.py`: T18. Escape mid-drag of the shade (lamp-01 unmoved in the SOM, on
  screen and on the server's `/__doc`; one Move of the shade recorded); a
  removal by another tab mid-drag; a disconnect mid-drag; after each, the
  next click selects (SP-L12).
- `c3.py`: `atrium.gltf`'s Furniture (a click, a triple-click, the
  breadcrumb, a double-click on every part on screen drilling one level) and
  Inspect as a visitor (the lamp, a hidden stand unreachable).
- `c4.py`: parts through the Edit panel's buttons: Duplicate, Undo, Redo,
  Delete, Undo, Redo of the shade and of Bench-NE, each checked on the
  server's copy; the copy 1.5 m along world x; Copy of the stand and Paste at
  the top level at its world height.

- `c5.py`: touch. A tap on a handle over the floor keeps the selection
  (SP-L10 on touch); a 6 and a 10 px touch drag on the handle keep it too,
  with one Move each (the outside code review's S-1); a double-tap.
- `c6.py`: rotate and scale modes, snaps off and on: a 2 px press draws and
  records nothing; a 40 px drag records one Rotate or Scale, snapped.

Run: `HARNESS_ROOT=/tmp/atrium-harness python3 -u c1.py` (and c2–c4). Each
prints PASS/FAIL lines and exits non-zero on any FAIL.
