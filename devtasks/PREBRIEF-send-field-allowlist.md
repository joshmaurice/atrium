# Pre-brief: client `send` is limited to an explicit list of edits (step 0c)

Status: **FINAL, Revision 1 (2026-10-12).**
- **Rev 0** was drafted by ChatGPT from the GitHub source at `88c56929`. It
  couldn't clone, so it ran nothing.
- **Rev 1:** Claude checked Rev 0 against a clone at
  `88c56929f02d55a3d41ec040cc59a806f1ed391b`, which has the same runtime code
  as the released `4d74a89e`. That check made the corrections in §8, which
  narrow the scope.
- **The operator approved the corrections and decisions D1–D5 (§4)** on
  2026-10-12.

**Priority:** security hardening, before Phase 3 step 1 (Edit mode).

**Inputs:**
- `devtasks/Atrium-Passdown-2026-10-12-create-template.md` §6.1 and §4 (the
  worker-card rules);
- `devtasks/Atrium-Passdown-2026-10-12-source-ref-guard.md` §6.1;
- `docs/DESIGN-phase3-placement-scripting.md` §4 and §9.

This is input for the brief-writing step. It is not the brief itself.

**Code facts:**
- **Line numbers:** approximate.
- **Implementation base:** a freshly fetched `origin/main` at kickoff,
  supplied from the host.

## 1. The problem

A `send` names a target (`msg.node`) and a path (`msg.field`), both chosen by
the client.

**How the server applies one:**
- **`session.js` `case 'send'` (~L532)** runs, in order: the avatar
  display-name guard, the source guard (S2), the mutation gate,
  `checkDestinationLength`, then `world.setField`.
- **`world.setField`** resolves the target with `som.getObjectByName(node)`,
  then calls `som.setPath(target, field, value)`.
- **`SOMDocument.parsePath` (~L8)** ignores stray dots and reads `[n]`
  indexes.
- **`resolvePath` (~L23)** walks any JavaScript property of the target.

**So a path can leave the named target:**
- `node='Child', field='parent.extras'` writes the parent;
- `node='Parent', field='children[0].translation'` writes a child.

Every check keyed on `msg.node` can be sidestepped that way. Object internals
may be reachable too.

**The shipped source guard protects one destination,
`extras.atrium.source`.** This task instead defines the edits that are
allowed, and refuses everything else (default deny).

## 2. What legitimate clients send (verified)

**The one wire producer** is `AtriumClient._onLocalMutation` (~L984). It
sends `{type:'send', seq, node, field, value}`. The listeners at ~L888–982
decide which paths appear.

**How each kind of object is addressed:**
- **Nodes:** by their own name. The client never attaches listeners to its
  own avatar (~L917).
- **Cameras and lights:** by their qualified alias, `somCamera.qualifiedName`
  / `somLight.qualifiedName`, which is `<host node>.camera` /
  `<host node>.light`. SOM *also* registers them under a bare glTF name when
  there's no clash (`SOMDocument.js` ~L150–197), but no first-party client
  sends the bare name.
- **Animations:** by name, field `playback` only.
- **The document:** `__document__`, field `extras` (a whole replacement).

| Producer | `node` / `field` | Allowed? |
|---|---|---|
| Inspector `PropertySheet` node section, and its drag gesture | node name / `translation`, `rotation`, `scale`, `visible` | **Allow** |
| Inspector material section | node name / `mesh.primitives[N].material.{baseColorFactor, metallicFactor, roughnessFactor, emissiveFactor, alphaMode, alphaCutoff, doubleSided}` | **Allow.** The inspector uses `N = 0` only; any in-range `N` is allowed |
| Inspector camera section | `<host>.camera` / `type`, `yfov`, `znear`, `zfar`, `xmag`, `ymag` | **Allow** |
| Client SOM camera API | `<host>.camera` / `aspectRatio` | **Allow** |
| Client SOM light API (client tests) | `<host>.light` / `color`, `intensity`, `type`, `range` (may be `null`), `innerConeAngle`, `outerConeAngle` | **Allow** |
| Inspector `AnimationsPanel` | animation name / `playback` | **Allow,** with the bounded schema (§3 A4) |
| Inspector `WorldInfoPanel` → `SOMDocument.setExtrasAtrium` (~L275) | `__document__` / `extras` (all of the root extras) | **Allow only changes to the World Info leaves** (§3 A3) |
| Existing server test `teleporter.test.js` ("exactly 2048 … allowed") | node name / `extras.atrium.teleporter.destination` | **Allow** this one leaf, on a node that already has `extras.atrium.teleporter` |
| Node `extras` / `extras.atrium` replaced whole | node name / `extras`, `extras.atrium` | **Refuse.** No first-party producer: the inspector shows `source` read-only, and `apps/client` sets teleporter destinations only at `add` (`app.js` ~L1346) |
| SOM mesh and primitive setters | `mesh.name`, `mesh.weights`, `mesh.extras`, `mesh.primitives[N].extras` | **Refuse** (D3) |
| `name` on any object | — | **Refuse** (D4) |
| Camera or light `name` / `extras` | — | **Refuse** |
| Protocol inspector (free-form JSON) | anything | Grants nothing |

**`visible` goes on the wire as the field `visible`.** The SOM stores it as
`extras.__atrium_visible` (`SOMNode.js` ~L61–69), but that key is never
sent, so it isn't an `extras` edit.

**The `WorldInfoPanel` leaves** (`WorldInfoPanel.js` ~L79–116), all under
root `extras.atrium`:

| Leaf | Value |
|---|---|
| `name`, `description`, `author` | string |
| `background.type` | `equirectangular` or `cubemap` |
| `background.texture` | string |
| `navigation.speed.default`, `.min`, `.max` | finite number (the panel uses `parseFloat` and refuses `NaN`) |
| `navigation.terrainFollowing`, `navigation.collision.enabled` | boolean |
| `navigation.updateRate.positionInterval`, `.maxViewRate` | finite number |

`navigation.mode` is read-only in the panel.

## 3. The security contract

### A1. Resolve the target, classify it, then allow exact operations

**Before any mutation, broadcast or save:**
1. Resolve `msg.node` the same way `world.setField` does.
2. Classify the *resolved object* by its class. Never infer the type from
   the name.

**What each class allows:**

- **`SOMDocument`:** only as `__document__`, field `extras` only, with the
  change check in A3.
- **`SOMNode`:** addressed by its own name. Allowed:
  - `translation`, `rotation`, `scale`, `visible`;
  - the material chain;
  - the teleporter destination leaf.
- **`SOMCamera`:** only when `msg.node === resolved.qualifiedName`, so the
  bare glTF name is refused. Fields: `type`, `yfov`, `aspectRatio`, `znear`,
  `zfar`, `xmag`, `ymag`.
- **`SOMLight`:** the same alias rule. Fields: `color`, `intensity`, `type`,
  `range`, `innerConeAngle`, `outerConeAngle`.
- **`SOMAnimation`:** `playback` only.
- **Anything else** (scene, mesh, primitive, material, skin, texture, or an
  unknown object) is refused.

**The material chain** is checked step by step:
`SOMNode → mesh → primitives[N] → material → <allowed property>`.
- `N` is a non-negative integer within the current primitives array.
- The mesh, the primitive and the material must all exist. If one is
  missing, the error is `INVALID_FIELD`.
- The chain allows nothing beyond the material property: no `.extras`,
  `.parent` or internals.

**Shared materials stay editable, as today (D5).** A test records that
editing a shared material affects every node that uses it.

**Live avatars:** refuse every `send` whose target is a live avatar node.
- **Who is affected:** everyone, including the world owner, in every world
  mode.
- **How to tell:** the active sessions' `avatarNodeName`, not a name prefix.
- **This breaks nothing:** the client never sends to its own avatar, and
  avatar movement uses `view`.
- **Keep the existing display-name guard** as defence in depth.

### A2. Canonical path spelling (D1)

**The accepted spellings are exactly:**
- `translation`, `rotation`, `scale`, `visible`;
- `mesh.primitives[N].material.<prop>`, with `N` written as decimal digits
  and no leading zeros except `0` itself;
- `extras.atrium.teleporter.destination` (nodes);
- `extras` (`__document__`);
- the bare camera, light and animation field names.

**Refuse every other spelling,** even when `parsePath` would read it the
same way. That includes:
- leading, trailing or repeated dots;
- stray characters;
- malformed brackets;
- extra segments (`translation[0]`,
  `extras.atrium.teleporter.destination.length`).

**The match is exact on the whole path.** No prefix or substring checks.

**The checker never calls `resolvePath` or `setPath` to find out where a
path lands.** It may share parsing code only.

### A3. World Info: authorize the changes, not the container

`__document__` / `extras` carries all of the root extras.

**The check:**
1. Compare the proposed value with the current root extras as plain JSON
   data.
2. List every changed leaf: additions, deletions and type changes.
3. **Accept only if every changed leaf is in the World Info list** (§2) and
   its value passes A4.
4. **Unchanged keys pass through untouched,** including keys this task
   doesn't know about. This keeps an old world's extra metadata when the
   inspector edits its name.
5. **Creating a missing intermediate object** (`background`, `navigation`,
   `navigation.speed`, `navigation.collision`, `navigation.updateRate`)
   counts as part of the leaf it holds.

**Refuse:**
- a value that isn't a plain object;
- arrays where objects are expected;
- the keys `__proto__`, `prototype` and `constructor` at any depth;
- payloads deeper than 8 levels or larger than 64 KiB once serialized.

**Any change to `extras.atrium.source` is refused.** The shipped S2 guard
stays as an independent check.

**One unauthorized change refuses the whole message.**

**Last writer wins, as today.** A test records it. No merging on the server,
and the `set` broadcast echoes the value as received.

### A4. Check each allowed value

The rules are type, length, enum and "finite" only. **No new range limits:**
they could break current inspector edits.

| Field | Required value |
|---|---|
| `translation`, `scale` | array of exactly 3 finite numbers |
| `rotation` | array of exactly 4 finite numbers; not normalized |
| `visible`, `doubleSided`, the boolean World Info leaves | boolean |
| `baseColorFactor` | 4 finite numbers |
| `emissiveFactor` | 3 finite numbers |
| `metallicFactor`, `roughnessFactor`, `alphaCutoff` | finite number |
| `alphaMode` | `OPAQUE`, `MASK` or `BLEND` |
| Camera `type` | `perspective` or `orthographic` |
| Camera numeric fields | finite number |
| Light `color` | 3 finite numbers |
| Light `type` | `directional`, `point` or `spot` |
| Light `intensity`, `innerConeAngle`, `outerConeAngle` | finite number |
| Light `range` | finite number or `null` |
| `playback` | plain object; keys only from `playing`, `paused`, `loop`, `autoStart` (booleans), `timeScale`, `startTime` (finite numbers), `startWallClock`, `pauseTime` (finite number or `null`). The key set is the `SOMAnimation` getters (~L114–121) |
| Teleporter destination | string of at most 2048 characters |
| World Info strings | string of at most 2048 characters |

**The destination limit is one shared validator** applied to the final
value. It replaces the raw-string `checkDestinationLength`, and its error
stays `INVALID_VALUE`.

### A5. Ordering and errors

**Order in `case 'send'`:**
1. the avatar display-name guard;
2. S2 (the source guard);
3. **the new allowlist**;
4. the mutation gate;
5. `world.setField`.

Running the allowlist before the gate means a forbidden edit is refused the
same way for everyone. If the brief author has a reason to put the gate
first, they can argue it; either order is acceptable.

**The allowlist applies in every world mode** (open, owner, read-only) and
to file worlds and document worlds alike.

| Case | Error |
|---|---|
| Unknown target | `NODE_NOT_FOUND`, as today |
| Forbidden target, operation or path | `PERMISSION_DENIED` |
| Allowed field with a bad value | `INVALID_VALUE` |
| Missing material chain or index out of range | `INVALID_FIELD` |

**Every error echoes `seq`.** A refusal causes no change in memory, no `set`
broadcast and no save callback. Messages must not expose internals.

**Structure:** a pure, exported decision helper, for example
`authorizeSend({ kind, field, value, current, ... })`, plus a small target
resolver in `session.js` or a new `send-policy.js`. Leave
`sendSetsAtriumSource` unchanged.

## 4. Decisions (operator, 2026-10-12)

- **D1 — Canonical spelling only:** yes (A2).
- **D2 — Node `extras`:** no whole `extras` or `extras.atrium` replacement on
  nodes. Only the teleporter destination leaf.
- **D3 — Mesh and primitive fields:** deferred, so all are refused.
- **D4 — Rename:** refused until Phase 3 §4.8 fixes the name maps.
- **D5 — Shared materials:** stay editable through the node chain. No other
  cross-node path.
- **Externally loaded nodes:** deferred (§8, item 5). Out of scope here.

## 5. Out of scope

- client or inspector UI changes;
- protocol or schema changes;
- `add` and `remove`;
- rename;
- Phase 3 metadata (`model`, `behavior`, `objectId`);
- protecting externally loaded nodes in file worlds;
- optimistic concurrency;
- migration.

The `send` wire format and the `set` broadcast stay unchanged.

## 6. Tests

New file: `packages/server/test/send-field-allowlist.test.js`.
- **Server setup:** port 0, with full teardown.
- **Pure policy tests,** plus real WebSocket tests in an owner world, an
  open world and a read-only world.
- **Both world types:** file worlds (`createWorld`) and document worlds
  (`createWorldFromDocument`).

### 6.1 Allowed

Each allowed case asserts the stored value, the `set` broadcast, and a save
notification only where the world is saveable.

- **Node fields:** `translation`, `rotation`, `scale`, `visible`.
- **Material:** all seven material fields on `primitives[0]`, plus one on
  another valid index if a fixture has one.
- **Camera:** `yfov`, `znear`, `type`, `aspectRatio` through
  `<host>.camera`.
- **Light:** `intensity`, `color`, and `range: null` through
  `<host>.light`.
- **Animation:** a full `playback` object.
- **World Info:** `__document__` / `extras` with exactly one changed leaf,
  for *each* World Info leaf. One case creates a missing `background` or
  `navigation` object. An unknown root key survives unchanged.
- **Teleporter destination:** the leaf at exactly 2048 characters (the
  existing test stays as it is).
- **Replay:** the exact messages `PropertySheet`, `WorldInfoPanel` and
  `AnimationsPanel` emit, either recorded or built through the real SOM plus
  `AtriumClient` listeners, not hand-made look-alikes.

### 6.2 Refused

Each refused case asserts the echoed `seq`, nothing changed, no broadcast and
no save.

- **Leaving the target:** `parent.translation`, `parent.extras`,
  `children[0].translation`, `scene.*`, `mesh._mesh.*`,
  `mesh.primitives[0].material._material.*`, `constructor.*`,
  `__proto__.*`. These include ordinary fields, not just `source`.
- **Non-canonical spellings:** `.translation`, `translation.`,
  `..translation`, `mesh..primitives[0].material.baseColorFactor`,
  `mesh.primitives[00].material.baseColorFactor`, `extras[x]`, empty
  string, `translation[0]`,
  `extras.atrium.teleporter.destination.length`.
- **Wrong target type:** node + `intensity`; light + `translation`;
  `__document__` + `translation`; a camera addressed by its bare glTF name;
  a node literally named `X.light` that is really a `SOMNode`.
- **Material index:** out of range (`INVALID_FIELD`).
- **Node `extras`** or `extras.atrium` sent whole (`PERMISSION_DENIED`).
- **World Info changes outside the list:**
  - adding, changing or deleting `extras.atrium.source`;
  - changing an unrelated root key;
  - changing `navigation.mode`;
  - nested `__proto__`;
  - over-deep or oversized payloads.
- **Live avatars:** a send to the sender's own avatar and to another
  session's avatar, both by the owner.
- **Who may edit:** a non-owner in an owner world, and anyone in a read-only
  world (the existing gate).
- **Bad values:** wrong array length or types, `null` where not allowed,
  bad enums, non-finite numbers (sent as strings or omitted, since JSON has
  no `NaN`), a `playback` with an unknown key, and a destination of 2049
  characters.

### 6.3 Existing suites

- **`teleporter.test.js`:** the two "long destination via whole `extras`"
  and "via whole `extras.atrium`" tests now expect `PERMISSION_DENIED`
  instead of `INVALID_VALUE`. Change only that assertion and explain it in
  the handoff. Every other existing test passes unchanged.
- **Baseline at `4d74a89e`:** 18 server files with 336 pass;
  `packages/client` 140; `apps/client` 191; 0 skipped.
- **Run each server file on its own,** and confirm it exits on its own.
- **Report** `node --version` and the skipped count.

### 6.4 Proofs of failure

Each proof must fail, with the expected assertions, exit nonzero and stop on
its own. Restore the code afterwards.

| Proof | Break | Must fail |
|---|---|---|
| (a) | Disable the new allowlist call, keeping S2 | the traversal tests (`parent.translation`, `children[0].translation`, `constructor.*`) |
| (b) | An allowlist that checks only the first segment, or a string prefix | the traversal, non-canonical, wrong-type and extra-segment tests |
| (c) | The A3 change check replaced by accepting `field === 'extras'` | the World Info forbidden-change tests |
| (d) | The A4 value checks removed | the bad-value tests, including the 2049-character destination |

## 7. Worker rules and operator checks

**Workers** follow the evening passdown's §4 rules:
- `pnpm install --frozen-lockfile --prefer-offline` in their own worktree,
  with no `node_modules` symlinks to `/workspace/atrium`;
- the full handoff (40-char SHA, per-file counts and exit codes, Node
  version, skipped count, proofs);
- progress comments.

**Before kickoff:**
- no open sentinel;
- a push dry run;
- the base SHA from a host fetch.

**DEV acceptance (`https://dev.ewwb.dev`, signed in as the owner, using the
inspector):**
1. Change the world's name, background and one navigation setting.
2. Move a node and toggle its visibility.
3. Change a material colour.
4. Change a camera setting, if the world has a camera.
5. Play an animation, if the world has one.

**Pass:** each change shows in a second client and survives a reload.

**A refused local edit stays visible until a refresh.** That's a known
pre-Phase-3 limitation (Phase 3 design §3.2). Watch the console for
unexpected `PERMISSION_DENIED`.

## 8. Rev 1 corrections to Rev 0 (from checking the code)

1. **No first-party code sends a whole node `extras` or `extras.atrium`.**
   So these are refused (D2), and the change check is needed only for
   `__document__`. Two teleporter test assertions change, as described in
   §6.3.
2. **`visible` is sent as `visible`,** so `__atrium_visible` isn't an
   allowed `extras` leaf.
3. **Cameras and lights are also registered under bare glTF names.** The
   allowlist requires `msg.node === qualifiedName`.
4. **The client never sends to its own avatar,** so refusing all sends to
   live avatars breaks nothing.
5. **Externally loaded nodes:** since step 0, document worlds don't load
   them; only operator file worlds do. Protecting them is a separate
   follow-up.
6. **Value rules are type, length, enum and "finite" only.** Rev 0's
   "glTF-appropriate bounds" and near/far ordering are dropped: they risk
   breaking current inspector edits.
7. **The inspector edits only `primitives[0]`'s material.** Any in-range
   index is still allowed, matching the client listeners.
8. **The inspector has no light panel.** The light fields are kept because
   the client SOM API and its tests use them.
