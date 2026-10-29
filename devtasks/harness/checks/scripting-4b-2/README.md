# scripting-4b-2 harness checks

Claude's browser checks for 4b-2 (behaviours, owner-present), run against the
harness server (`devtasks/harness/server.mjs`, ports 8443/8444; a spare on
9443/9444 via `PORT_A`/`PORT_B`). Each script is self-contained and prints one
line per check; none of them asserts — read the output. Run them from this
folder with `python3 <script>.py`.

| Script | What it checks | Round |
|---|---|---|
| `rt.py`–`rt5.py` | The runtime without the form: each template written with `templateGraph` + `sendField`, real canvas clicks; two owner tabs and the handover, a 4b-1-style tab, restart from the saved document, Duplicate's remap, first person, the send queue and its cap | 4–5 |
| `f1.py`, `f1b.py`, `f2.py`, `f3.py` | §5.1 through the Behaviour form (real `<select>` choices and button clicks): F1–F12, Remove, a Custom graph, a missing clip, the hints, the multi-stage Save on an id-less node, a leaf arriving under a selected node, another tab's change over an unsaved edit, clean proximity with a second avatar | 5–6 |
| `o1.py`, `o2.py` | The round-4 outside review's scenarios (M1, M3, M5) | 5 |
| `deep.py`, `deep_doc.py`, `deep_add.py`, `deep_avatar.py` | Deeply nested messages against a spare server: a behaviour value, a saved document, an owner's `add`, a visitor's avatar `add` (the message-depth-guard hotfix) | 5, hotfix |
| `dev2.py`, `dev2b.py`, `noid.py`, `noid_prox.py`, `prox3.py`, `prox3b.py` | Reproductions of what round 6's DEV acceptance found (a model with no clips, an id-less world, cross-tab proximity). **On round 7 and later they stop at Save, which is now correctly disabled**; `r7.py` is their successor | 6 |
| `r7.py` | Round 7's X1–X6 in the page: labelled rows, the no-animations model, the field check with zero sends past it, shown == held through every step including an id-less Save, the scrolling panel and the wheel | 7 |
| `c4_4b1_newtext.py` | 4b-1's `c4` with 4b-2's non-host text | 5–7 |

The regression set run with these each round: `../scripting-4b-1/` (c1, c8;
c4 via `c4_4b1_newtext.py`), `../scripting-4a/` (c1, c4, c6, c7, c8b, c9),
`../library-sky/` (c1, c1b, c1c, c11–c14, c23, c4, c5, c67, c8, c910) and
`../edit-polish-3/` (a–f): 28 scripts. Compare each output with the previous
run's, ignoring numbers, ids and avatar names.
