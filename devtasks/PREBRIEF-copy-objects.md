# Pre-brief: copying objects between worlds (`copy-objects`)

Status: **DRAFT, Revision 1.2 (2026-11-06), after a fresh-agent check and the operator's decisions (§7).
Decided (operator, 2026-11-06): PC (b), the cap fix as this round's first
commit; CP-L3 (c); and, "no preference", so the recommendations: CP-L1 (a),
CP-L2 (a), CP-L4 (a), CP-L6 (a), CP-L7 (a), CP-L8 (a); CP-L5 (c), the middle
path, after discussion (§3).** PC is outside the copy feature: PROD's path has
no 1 MiB message cap (§2.6). **Next: one ChatGPT review of this file (CP-L8).** The contract for the third of the three rounds in
`PREBRIEF-richer-add-copy.md`, carved out of that file's Rev 0.4 (§3 CP-L1–CP-L7,
§6), as `add-check` and `richer-add` were. CP-L8 (how the round runs) is new.
- **What it builds on.** `PREBRIEF-richer-add.md` FINAL Rev 2 (shipped as
  `3fcc296c`): Duplicate's builder and rules, which a copy reuses unchanged.
  `PREBRIEF-add-check.md` FINAL Rev 1.1 and `richer-add`'s R1–R10 hold here
  unchanged: a paste is an ordinary world `add`.
- **Against `main` at `f286d283`**, whose code is PROD's `3fcc296c` (the
  difference is `devtasks/` only). Every line number below is at that commit.
  `app.js` is unchanged since `cdfe88a8`, so Rev 0.4's `app.js` lines still hold;
  `edit-duplicate.js` and `session.js` moved with `richer-add` and are recited.
- **How it was checked.** Claude read every cited line at `f286d283`. No probe
  was run and the app wasn't opened in a browser: every fact here is from the
  source. The fresh-agent check (§7) is still to come.
- **What's new since Rev 0.4** (found while rechecking, §2):
  - **a teleporter's destination is a path resolved against the world it's in**
    (§2.8), so a pad pasted onto another server would silently lead somewhere
    else. CP-L6 now covers pads as well as models;
  - **the client can't name the owner of every world it can copy from**
    (§2.4): the commons' address is `/`, a home world can be `/home/<user id>/home`,
    and a slug can be renamed through the API. So CP-L3 (c) now needs `hello`
    to carry the world's id and owner, which Rev 0.4 left open;
  - **ids are per server** (§2.4): a credit carries the source server's origin;
  - **a paste can land only in a world the page can edit**, and on PROD that's
    always on the page's own server (§2.5).
- **Sources:** `PREBRIEF-richer-add-copy.md` Rev 0.4 (§2.8, §3 CP-L1–CP-L7, §6,
  §9); its reviews, cited as in that file: **CR**
  (`REVIEW-richer-add-copy-rev0.1-claude.md`), **GR**
  (`REVIEW-richer-add-copy-rev0.1-chatgpt.md`) and **GR2**
  (`REVIEW-richer-add-copy-rev0.1-chatgpt-2.md`, the second ChatGPT review);
  `Atrium-Passdown-2026-10-19-copy-objects.md` (decisions C1–C4);
  `docs/DESIGN-phase3-placement-scripting.md` §6 (item 3: an imported
  behaviour arrives disabled, its grants limited to its own subtree) and §10 Q6
  (visitors may read scripts); `PREBRIEF-models-by-url.md` L12 and P7;
  `PREBRIEF-library-sky.md` §9 item 1.

## 1. What this delivers
**Copy an object while visiting any world you can see, and paste it into a
world you can edit,** as C1–C4 decided:
- an **Inspect** mode for visitors (CP-L1): select an object, read about it,
  Copy it. Owners get Copy and Paste in Edit mode;
- a clipboard of one object, held in memory: it survives teleports, not a
  reload (CP-L2);
- the paste is an ordinary world `add` at the palette's spot ahead of you, so
  it's checked by the server like any add, and Undo removes it;
- the copy carries **credit, worded as claimed** (C4, CP-L3, CP-L4):
  `origin` (fixed at the first copy) and `copiedFrom` (this copy);
- a behaviour from another world arrives **disabled**, with its references
  kept, except any aimed at objects in your own world, which are defused
  (CP-L5);
- a model URL or pad destination that means "this server" keeps its meaning on
  another server (CP-L6);
- C2's plain note, "visitors can see and copy anything in this world" (CP-L7).

**What copies:** whatever Duplicate copies, since `richer-add`: on PROD **445 of
455** top-level objects (`p6` at `3fcc296`). Groups (PROD's 9 objects with
children) wait for the subtree `add`, the next placement round.

**Not in this round:** groups; several objects at once; a clipboard that
survives a reload or crosses tabs; rebinding a behaviour's grants to objects in
the new world; verified provenance; a licence label (C4's "later, optionally");
export and import as files (design §6 items 1–2, step 7); a name route
resolving ids to current names.

## 2. Verified facts (at `f286d283`)

### 2.1 What a copy can reuse (`apps/client/src/edit-duplicate.js`)
- **`duplicateRuleProblem` (L320–348)** is D5's whole rule: no children, top
  level only, no camera, light or skin, not animated or skinned into, no
  `source` (externally loaded), `atriumProblem` (L101–127), `meshProblem`, no
  node extensions, a unit rotation and positive scale, and a size bound.
- **`buildDescriptor` (L256–290)** builds the `add` from the live node:
  name, TRS, `extras` (deep-cloned, L264–265), and the mesh with every field
  `richer-add` carries. **It holds no live SOM object** in its result: every
  array is `Array.from` and every `extras` is `structuredClone`d.
- **`prepareDuplicate` (L403–417)** gives the copy a new `objectId`
  (`withNewObjectId`, `object-identity.js` L33–40, which creates `extras.atrium`
  if needed), remaps its behaviour's self-references (`withRemappedBehavior`,
  L386–392), measures the whole message against `MAX_ADD_BYTES` (1,000,000,
  L41) and runs `add-spec.js` on it (A7, `addSpecProblem` L380–383).
- **`atriumProblem` mirrors most of the server's L5 checks** (`checkAtriumExtras`,
  `send-policy.js` L166–207): the object id, the teleporter, the model value,
  and the behaviour through `behaviorCheck` with the node's own id (L122–125).
  **Not the animation value** (Rev 1.1, fresh-agent check): a malformed
  `extras.atrium.animation` passes the client and gets the server's refusal
  text. **Neither looks at an unknown `extras.atrium` key.**
- **Other `extras` travel too:** up to 16 KiB of keys outside `atrium`, among
  them the SOM's hidden marker `__atrium_visible` (`SOMNode.js` L77–80). So
  today a Duplicate of a hidden object is hidden.
- Duplicate and Undo keep every `extras.atrium` key, so a credit set by a paste
  survives a Duplicate and a delete-and-Undo in the destination.

### 2.2 Selection and clicks
- **Edit mode is the only way to select** (`canEditNow()`, `app.js`
  L1582–1584: `client.canEdit && avatarReady && client.connected`). Outside it a
  click on an object whose behaviour listens for `select` sends `activate`
  (`activate-click.js`).
- **Edit mode picks hidden objects on purpose** (F-L8: the owner un-hides one):
  `visibleHits(…, { includeHidden: true })` (`app.js` L2134–2138), then
  `pickEditSelection` with `isEditExcluded` (avatars) and `resolveSelectionRoot`
  (L2142–2148). Outside Edit mode `PointerInputBridge._hitTest` skips hidden
  objects (`includeHidden = false`, `PointerInputBridge.js` L96–105).
- **Edit is the only mode `edit-modes.js` knows** (L8, L26–34): it turns
  teleport triggers off while editing (`triggerActive = !edit`) **and suspends
  pointer lock** (`usePointerLock = pref && !edit`, L37). Outside Edit mode a
  locked click aims from the crosshair (`behaviorAim`, `app.js` L2230–2243);
  Edit's picker reads the pointer's `clientX/Y`, stale while locked.

### 2.3 How long a clipboard can live
- **The client uses no browser storage** (no `localStorage` or `sessionStorage`
  in `apps/client/src` or `packages/client/src`).
- **Nothing reloads the page:** `app.js` never sets `location` or calls
  `reload`; teleports, world loads and sign-in all happen in the page. So a
  clipboard held in memory survives a teleport and a sign-in, but not a reload
  or another tab.

### 2.4 What the client knows about the world it's in
- **Its connection:** the world's ws URL (`currentWorldUrl`, `app.js` L516)
  and the world's base URL (`client.worldBaseUrl`, `AtriumClient.js` L364,
  derived from the ws origin at L663–668 when not given).
- **The address isn't always a name** (`world-registry.js` L29–36, L101–157):
  `/` (and `/apps/client`, L104) is the commons; `/worlds/<username>/<slug>` and the legacy
  `/public/<username>/<slug>` name the owner; `/home/<user id>/home` and
  `/ws/<world id>` don't.
- **The address isn't a stable key either:** `PUT /api/worlds/<id>` accepts a
  new `slug` (`http-routes.js` L723–724; `world-store.js` L92–100), though no
  UI sends one, and a deleted world's slug can be taken again (the constraint
  is `UNIQUE (owner_user_id, slug)`, `db.js` L70).
- **No route renames a user** (the auth routes are `register`, `login`,
  `logout` and `me`, `http-routes.js` L160–478), and no route resolves a user
  or world id to a name.
- **`hello` carries the session's own `userId` only** (`hello.server.json`;
  `session.js` L856–876): not the world's id or its owner.
- **The server has both at hand:** `attachSessionHandlers` gets `worldId` and
  `worldOwnerUserId` (`session.js` L392–398; `world-host.js` L56, L61), and the
  hello handler already looks a username up in the database (L769–791), in a
  `try` with a fallback. **Many server tests run an owned world with `db: null`
  and owner ids like `user-a`** (`script-host.test.js` L92–104,
  `edit-plumbing.test.js` L163–167) and validate its `hello` against the schema
  (`script-host.test.js` L127–139, `edit-plumbing.test.js` L390): there the
  owner has an id and no name. A file-loaded world has no owner (`null`).
- **Ids are per server:** a user id or world id is a UUID from that server's
  database (`db.js` L41, L61), and means nothing on another Atrium server.
- **The client doesn't validate incoming messages** (`richer-add` §2.2), so
  new `hello` fields reach an older client harmlessly, **and a newer client
  must check them itself**: another server can send anything. `signedIn` shows
  the pattern: reset at connect and disconnect (`AtriumClient.js` L640, L850,
  L908, L973) and type-checked where it's read (L1161).

### 2.5 Where a paste can land
- **Paste needs a world the page can edit:** `canEdit`, which the server sets
  for the owner when the world's policy lets the owner mutate.
- **A cross-origin connection is always anonymous** (signin-sync I1;
  `richer-add` §2.7), so it can't edit a world with an owner. **Every world the
  shipped server runs has an owner or is read-only** (a degraded boot registers
  the commons `read-only`, `commons.js` L194; nothing registers an `open`
  world), so on PROD and DEV a paste always lands on the page's own server. An
  `open` world exists only on a test server (corrected in Rev 1.1).
- **The source can be anywhere the page can visit,** another server included
  (cross-server connect): you can copy on server A anonymously, teleport home,
  and paste on the page's server B.

### 2.6 Credit keys today
- **`checkAtriumExtras` accepts unknown `extras.atrium` keys without looking
  at them** (L166–207), and A2's 16 KiB bound covers `extras` **other than**
  `atrium` (`worldExtrasProblem`). So today an `origin` or `copiedFrom` of any
  value passes, **bounded by nothing on PROD's path** (next item).
- **Corrected in Rev 1.1, and wider than this round: the 1 MiB message cap
  isn't on PROD's path** (fresh-agent check, reproduced). `maxPayload` is set
  only by `createSessionServer` (`session.js` L306), the single-world path that
  `payload-cap.test.js` tests. Every world the registry hosts, PROD's included,
  goes through `createWorldHost`, whose `new WebSocketServer({ noServer: true })`
  (`world-host.js` L46) sets none, so `ws`'s default of 100 MiB applies. Probe
  (`/tmp/copy-check/payload.mjs`, rerun by Claude): a 1.5 MB world `add`
  through `createWorldHost` was accepted and stored. Whether the host's proxy
  caps frames is unknown. So `MAX_ADD_BYTES` is a client limit only, and
  K3's bounds are the credit's only bound. **The fix is one option on one line,
  and is put to the operator as its own question (§3, PC).**
- **`send` can't write node `extras`** except the named leaves (`NODE_FIELDS`,
  `name`, the material chain, and the teleporter destination, animation,
  `objectId` and behaviour leaves, `send-policy.js` L70, L347, L437, L512), so a
  credit set at `add` time can only change by deleting the node and adding it
  again.
- **A malformed credit already saved isn't healed at load** (unlike an object
  id or a behaviour, `world.js` L338, L414). Nothing writes one today.

### 2.7 Behaviours
- **The leaf's keys** are `kind`, `graph`, `nodeMap`, `targets`, `animations`,
  `proximity`, `interval`, `template`, `enabled` and `origin`
  (`behavior-spec.js` L87–88). `origin` must be `"local"` (L621) and `enabled`
  a boolean (L622).
- **`nodeMap` is positional:** 1–16 unique ids whose entry 0 must be the
  object's own id (L774–780), and graph pointers and literals bind to it **by
  index** (`pointerBinding`, L910–940), as `/animations/<i>` references bind to
  the `animations` table (L796–826). Removing an entry shifts every later
  index (CR-S5, GR-M3, GR2-M4).
- **`targets` is the authority grant:** a write reaches the behaviour's own
  node, its descendants, or an id in `targets` (`adapter.js` L23–25;
  `runner.js` L283). A template's `targets` is `[]` when it acts on its own
  object, and `[target]` otherwise (`templates.js` L63–67).
- **Duplicate remaps only self-references** (`remapBehaviorTargets`,
  `edit-duplicate.js` L362–373: `nodeMap`, `targets`, `animations[].object` and
  `template.params.target` equal to the original's id), and keeps every other
  entry as a grant (F-L10).
- **An owner chooses their objects' ids, and any visitor reads every id** in a
  public world's `som-dump`. So a hostile world can publish a behaviour whose
  grants name objects in the paster's own world (CR-S5).
- **Graph import arrives disabled** (`graph-import.js` L772), but **doesn't
  limit its grants**: `targets` is every mapped object outside the own subtree
  (L768–771; corrected in Rev 1.1). Design §6 item 3's limit is for import from
  outside, still to come.
- **Enabling asks first only for a custom graph that writes and starts on load
  or runs every frame** (`shouldPromptEnable`, L537–543; `setEnabled`,
  `behavior-form.js` L718–735); a template never asks. The question names the
  grants (`enablePromptText`, L550–555), and with none it reads "It can also
  change: . Enable it?" (corrected in Rev 1.1).

### 2.8 Models and pads: URLs that mean "this server"
- **A model URL is `https://…` or a single-slash root path**
  (`modelUrlProblem`, `model-spec.js` L76–101: `http://` is refused,
  `url-scheme`). A root path resolves against **the world's base**, never the
  page's (`resolveModelUrl`, L123–138).
- **A library item stores its path** when the world is on the page's origin,
  and the absolute URL on the page's origin otherwise (`storedUrl`,
  `library-catalog.js` L309–314).
- **The fetch's protections:** `credentials: 'omit'`, `referrerPolicy:
  'no-referrer'` on every request (`model-fetch.js` L40–41), and the per-model
  and per-world budgets.
- **New: a pad's destination is resolved against the world it's in.**
  `checkTeleporterDestination` accepts any string up to 2,048 characters
  (`send-policy.js` L140–147); the pad form accepts `/`, `/worlds/<user>/<slug>`
  or a `ws(s)://` URL (`isValidDestination`, `wsUrl.js` L217); and a path is
  resolved against **the current world's** server when the pad fires
  (`resolveWorldAddress(destination, currentWorldUrl)`, `app.js` L586–588;
  `wsUrl.js` L167–206). So a pad leading to `/worlds/alice/garden` on server A,
  pasted on server B, would lead to B's `alice/garden`, or nowhere. A
  `ws://` destination is allowed (unlike a model's `http://`).

### 2.9 What a paste reuses
- **The structure tracker** (`createStructureTracker`, `edit-structure.js`
  L84–160): one structural request at a time, and the answer decides what's
  shown. **The generic answer path** (`onStructureAnswer`, `app.js`
  L2869–2878) words a refusal "Couldn’t <verb>: <the server's text>" with
  `STRUCTURE_VERB` (add, duplicate, delete), shows nothing for an `unknown`
  answer, and retries "already in use" only for a palette add
  (`request.primitive`). "The world did not answer" comes from
  `orphanAddError` (L2787–2790), which only the pad, model and library
  branches use (corrected in Rev 1.1).
- **Undo's add entry** (`undo.registerAdd`, as the pad form uses it, `app.js`
  L3794–3795).
- **The palette's spot ahead of you** (`palettePlacement`, `edit-palette.js`
  L35–44; used at `app.js` L1645, L2698, L3745) is **on the ground, y = 0**
  (L40); and **names**: `copyName`
  (`<name> copy`, `<name> copy 2`…, L103–105) over `firstFreeName`.
- **The world browser's Public/Private toggle** (`app.js` L290–345) is where a
  world is made public.

## 3. Decisions (for the operator)
Binding from earlier rounds: C1–C4 (operator, 2026-10-19); RA-L1–RA-L8.

**CP-L1. How a visitor copies.**
- **(a) Recommended: a read-only Inspect mode** for anyone who can't edit,
  beside the Edit toggle:
  - it selects with Edit mode's rules (`pickEditSelection`, avatars excluded,
    the group root resolved) **except that it skips hidden objects**
    (`includeHidden: false`, GR2): what a visitor is offered is what they see;
  - it shows a read-only panel: the object's name, **Copy** (or why it can't be
    copied, Duplicate's reason), its credit (CP-L3), its behaviour if it has
    one, as a summary (design Q6), and C2's note (CP-L7);
  - clicks in Inspect mode don't send `activate`. Walking onto a pad still
    teleports (Inspect changes clicks only, and the clipboard survives);
  - everything shown that another user wrote (names, credit, graph labels) goes
    through `textContent` or `escHtml` (CR-N5, GR).
  
  Owners get Copy and Paste in Edit mode.
- (b) A Copy item on right-click, with no mode. Smaller, but the client has no
  such gesture yet, and it shows nothing before copying.
- **Reviews:** CR, GR and GR2 all (a). Graphs are already in every visitor's
  `som-dump`, so Inspect adds UI, not exposure (CR).

**CP-L2. The clipboard.**
- **(a) Recommended:** in memory, one object at a time; it survives teleports
  and sign-in, not a reload (§2.3). **A snapshot built at Copy** (GR-S8, GR2-S6):
  the descriptor deep-cloned from the live node, plus where it came from (the
  source's base URL and origin from the live connection, and the world's id and
  owner from `hello`). It holds no SOM object, so a teleport (which replaces the
  SOM) can't touch it, and a later change to the original doesn't reach it.
  Paste applies the new name, `objectId`, position, credit, behaviour rule and
  URL rule, then measures and checks the message again. **A failed paste leaves
  the clipboard as it was.**
- (b) `localStorage`, surviving a reload and crossing tabs: the client's first
  stored state, with the questions that brings (a stale copy, size, other
  worlds' tabs).
- **Reviews:** all (a).

**CP-L3. The credit's shape (C4).**
- **(c) Recommended (CR-S6's choice, completed):** store **the ids as keys and
  the names as seen at Copy**, from `hello`, with **no name route**:
  - `hello` gains `world: { id, owner: { id, name } }` (`owner` absent when the
    world has none). The server has both (§2.4); the owner's name is one more
    username lookup at hello;
  - the credit records the **server** too, because ids are per server (§2.4);
  - the panel shows the stored names, worded as claimed (below).
  
  Why `hello` is needed after all (Rev 0.4 left it open): the client can't name
  the owner of the commons (`/`) or a world reached by `/home/<user id>/home`
  or `/ws/<id>`, and a slug can change (§2.4), so the address alone is neither
  complete nor stable.
- (a) C4 as written: ids only, and a public route that resolves ids to current
  names (limited to worlds the caller can see, rate-limited, CR and GR). It
  shows current names, but it's a new route, and ids from another server can't
  be resolved by this one.
- (b) The address and username only, no server change. Fails for the commons
  and the `/home/` and `/ws/` forms (no username in them), and a renamed slug
  leaves a stale address (§2.4).
- **Either way: the credit is claimed, not verified** (CR-S6, GR-S6, GR2-S3). A
  modified client can write any ids and names. The panel says so in its words:
  "Made by <name>, it says" is the shape; the brief settles the text. Showing
  the stored name (not a fresh lookup) keeps the claim looking like a claim.
- **Exposure:** `hello` would tell every visitor the owner's user id. Nothing
  admits by id alone: `/home/<user id>/home` admits only that same signed-in
  user (`world-registry.js` L268–281), and visibility decides the rest (C3). An
  id is an opaque key, not a secret, but it's newly visible.

**CP-L4. What the server checks on the credit.**
- **(a) Recommended: form and bounds only,** in `checkAtriumExtras` and its
  client mirror `atriumProblem`, with shared vectors: exactly the keys C4 below
  defines, each a bounded string of its form, nothing else. The server can't
  verify where an object came from (C4: "credit, not proof"). `send` can't
  change it afterwards (§2.6). CR notes same-server provenance could later be
  made verifiable (the server stamping `origin` itself); not now.
- (b) Nothing, as today: unbounded (§2.6), so not this.
- **Reviews:** all (a), with CP-L3's wording.

**CP-L5. A behaviour on paste.** **Decided (operator, 2026-11-06): (c), the
middle path,** after a discussion that moved Claude off its (a2).
- **(c) Decided: keep the ids, and defuse only those that match an object in
  your world.**
  - **The same world** (the source's server and world id are the
    destination's, both known): kept exactly as Duplicate keeps it, grants and
    enabled state included (F10).
  - **Another world:** self-references are remapped to the copy (F10), the
    behaviour arrives **`enabled: false`**, and every other id is **kept as it
    is**, unless it is the id of an object in the destination world, or one
    its Undo stack can bring back. Each such id is replaced by a fresh one,
    the same replacement wherever it appears (`nodeMap`, `targets`,
    `animations[].object`, `template.params.target`), and the paste says
    plainly: "Its behaviour referred to objects in your world. Those references
    were removed."
  - **Why a match can only be deliberate:** object ids are random; a new world
    starts from a template with none (`newWorldDocument`, `home-world.js`
    L40–60), the commons' seed has none, and every add and paste stamps a new
    one (`withNewObjectId`). So a foreign id equal to one of yours was put
    there by someone who read your world, which any visitor of a public world
    can (§2.7).
  - **What it keeps:** in the friendly case, everything. A reference to an
    object the destination doesn't have is inert (it reaches nothing, as a
    fresh id would), and its record of what it pointed at survives. A
    template aimed at one opens in the Behaviour panel with "Choose a
    target…" (X4: a held target that isn't among the picker's options gets
    that placeholder, `behavior-form.js` L926–933; the unchanged ids keep the
    value matching its template, `matchesTemplate` L164–174), so the owner can
    re-aim it at one of their own objects.
  - **What it doesn't cover:** an id that comes to match later. Only the
    owner's own client adds objects to their world, always with a fresh id,
    and Undo's restores are counted at paste, so the remaining case is a
    restore of an object deleted after the paste whose id the source had
    aimed at. Stated, not closed. The check runs again at every paste, so
    carrying the object on to a third world checks there.
  - **Enabling works as today** (§2.7): a custom graph that writes and starts
    on load or runs every frame asks first, naming its grants; a template
    doesn't ask. A grant the world doesn't have is named "an object not in
    this world" (K7).
- (a2) Keep a behaviour only if it refers to nothing but its own object, and
  drop it otherwise (GR's, and Claude's first recommendation). Simpler to
  prove, but it throws away every behaviour that refers to anything else,
  and the record of what it referred to, with nothing gained in the friendly
  case.
- (a1) Replace **every** foreign id with a fresh one (CR's). As safe as (c),
  but it loses the record of what the behaviour referred to, which (c) keeps.
- (b) Keep every id unchanged, disabled. A hostile world's aim at your objects
  then works once you enable it, and a template enables without a question.
- **Where the reviews stood:** all three wanted every foreign reference
  neutralised or the behaviour omitted (CR-S5, GR-M3, GR2-M4). (c) narrows that
  to the references that can do something in the destination, on the
  reasoning above; **the outside review of this file should test that
  reasoning.**
- **"Defused" never means "removed from the list"** (CR-S5, GR-M3, GR2-M4): the
  result passes the real validator with its bindings intact; an id is replaced
  in place, never deleted.
- **A behaviour can't reach anything outside the world** (operator's question,
  2026-11-06): no graph operation touches the network (`EXECUTABLE`,
  `behavior-spec.js` L116–139), and the planned JavaScript runner removes
  network access (design §5.7). So the ids are a pasted behaviour's whole
  reach beyond its own object.
- `origin` stays `"local"` until step 7 gives it a URL form.

**CP-L6. URLs that mean "this server": models and pads.**
- **(a) Recommended (Rev 0.4's rule, widened to pads):**
  - **resolved at Paste, not Copy** (CR-S7, GR-S7): the clipboard keeps the
    source's base. When the destination's origin is the source's, nothing
    changes (and a same-server paste survives a domain move). When it differs:
    - a root-path model URL becomes absolute against the source's base, then
      goes through `modelUrlProblem` again (GR2-S4). An `http://` source (DEV)
      gives a URL the model rules refuse: the paste says so plainly and sends
      nothing;
    - **a path pad destination becomes the source server's absolute `ws(s)://`
      address** (§2.8), so the pad still leads where it did. `ws://` is allowed
      for destinations;
  - pinned `sha256` and `bounds` travel unchanged;
  - **"Library" credit only when the resolved URL is under `/assets/library/`
    on the destination's own origin** (CR-S7), or
    `https://evil.example/assets/library/x.glb` would be labelled as Atrium's;
  - **another host is shown before it's fetched** (GR-S7): the paste names the
    model's host when it isn't the destination's. A hostile world can already
    make every visitor fetch any `https` URL (CR), so this is disclosure;
  - the fetch keeps today's protections (§2.8), and **the source base comes
    from the live connection at Copy**, never from a field the object carries
    (GR2-S4).
- (b) Refuse to paste a root-path model or a path pad onto another server.
  Simpler; it makes library items from another server uncopyable there.

**CP-L7. Where C2's note goes** (models-by-url L12 (b) put it here). "Visitors
can see and copy anything in this world."
- **(a) Recommended:** in the Inspect panel, and beside the Public/Private
  toggle in the world browser (§2.9). The models-by-url note (a model's host
  sees visitors' addresses, design §4.3) goes with it in the Inspect panel.
- (b) Only in the Inspect panel.
- **Reviews:** all (a).

**CP-L8. How the round runs (new; passdown §4, cost matters).**
- **(a) Recommended: `richer-add`'s cheap round.** One ChatGPT review of this
  pre-brief, pinned to a SHA; Claude's fast lane on `claude/copy-objects`; a
  fresh-agent check of the code; one ChatGPT code review; publish and deploy
  from the host. No OpenRouter credit. The contract names every rule and file,
  so an independent implementer adds little; the independence that found real
  bugs was the outside reviews' and the fresh agents'.
- (b) The GLM pipeline for the client part. More independence in the
  implementation, at OpenRouter cost, and it's mostly UI in `app.js`, which the
  pipeline has found hardest.

**PC. The missing 1 MiB cap on PROD's path (new in Rev 1.1; §2.6).** **Decided
(operator, 2026-11-06): (b), this round's first commit (K0).** Not a
copy decision, but live today: every world the registry hosts accepts messages
up to `ws`'s 100 MiB default, from any visitor, anonymous ones included. Each
message is parsed with `JSON.parse` before any check, on the one Node process
every world shares (the stall CR-M2 measured at 3.8 s for 938 KiB of `add`),
and `add-check`'s budgets assumed the 1 MiB cap.
- **(a) Recommended: a small round of its own, now, before `copy-objects`:**
  `maxPayload: MAX_PAYLOAD_BYTES` on `createWorldHost`'s server, and a test
  through `createWorldHost` (port 0) that a message over 1 MiB closes the socket
  with 1009 and changes nothing, failing on today's code first. One server
  file, fast lane, no outside review beyond the code review. **Before it, the
  operator checks whether the host's proxy already caps WebSocket frames**,
  which says how live it is.
- (b) Fold it into `copy-objects` as its first commit. One release fewer, but
  the fix waits for the larger round and its review.

## 4. The contract (written for the recommendations)
Where an option not recommended is chosen, the brief changes the item named.
`PREBRIEF-add-check.md` and `PREBRIEF-richer-add.md` hold where this says
nothing.

- **K1, `hello` (CP-L3 (c)).** The server's `hello` gains
  `world: { id, owner?: { id, name? } }`: `id` the host's `worldId`; `owner`
  present exactly when the world has an owner, with its user id, and `name`,
  its current username, **only when the lookup finds one** (no database, a
  test owner id, or a failed lookup: no `name`; the hello is never refused for
  it). `hello.server.json` gains it, `additionalProperties: false` at each
  level, ids and the name as strings of `minLength` 1 (not UUIDs: tests use
  `user-a` and `default`) (AGENTS rule 1), with its protocol tests; the tests
  that validate an owned world's hello with `db: null` (§2.4) still pass.
  **`AtriumClient` checks it itself** (§2.4): it keeps `client.world` only if
  every value is a string in K2's form and length, else `null`, and resets it
  where `signedIn` is reset (L640, L850, L908, L973).
- **K2, the credit (C4, CP-L3, CP-L4).** In `extras.atrium`:
  
  | Key | Value |
  |---|---|
  | `origin` | `{ server, world, creator, creatorName, at }`, set at an object's **first** copy and never changed after |
  | `copiedFrom` | `{ server, world, address, at }`, replaced by each copy |
  
  | Field | In | Required | Form |
  |---|---|---|---|
  | `server` | both | yes | an `https:` or `http:` origin (`new URL(v).origin === v`), at most 256 characters |
  | `at` | both | yes | `YYYY-MM-DD`, a real date (UTC) |
  | `address` | `copiedFrom` | yes | a path starting with `/`, at most 2,048 characters, no character below U+0021 |
  | `world` | both | no | 1–128 characters, no character below U+0021 (K1's id) |
  | `creator` | `origin` | no | as `world` (K1's owner id) |
  | `creatorName` | `origin` | no | 1–256 characters (`NAME_MAX`) |
  
  - **No other key, in either.** An optional field is absent, never `null` or
    `""`. Any other shape is refused: `add`'s usual `INVALID_VALUE`, with a
    message naming the field.
  - `creatorName` may stand without `creator` (a library model, below, or a
    source whose owner had no name); `creator` may stand without `creatorName`.
  
  **Filling `origin` at Paste** (C4):
  1. the copied object already has an `origin` that passes K3: carried
     **unchanged**, whatever it holds or lacks;
  2. otherwise, a **library model** (CP-L6's rule): `{ server, at,
     creatorName: "Library" }`. Placing a library item doesn't change in this
     round (library-sky §9 item 1's credit at placement stays open);
  3. otherwise: `{ server, at }` plus `world`, `creator` and `creatorName` from
     the snapshot's K1 values, each **only if present and in K2's form** (a
     value that isn't is dropped, never a reason to refuse the paste).
  
  An existing `origin` or `copiedFrom` that fails K3 is replaced as if absent,
  and the paste's notes say so. `copiedFrom` is always this copy's.
- **K3, the server's check (CP-L4).** `checkAtriumExtras` (`send-policy.js`)
  checks K2's form when either key is present; the client's `atriumProblem`
  (`edit-duplicate.js`) gives the same verdict, so a Duplicate or Undo of a
  malformed legacy credit is refused with its own reason. Both read a new
  `tests/fixtures/credit-vectors.json` (the `model-spec-vectors.json` pattern).
  Unknown `extras.atrium` keys stay unchecked, as today. K3 is the credit's
  only bound until PC lands (§2.6). The client's missing animation check
  (§2.1) is out of scope and stated. A malformed credit already saved isn't
  healed at load (nothing writes one today).
- **K4, Inspect (CP-L1).** A new mode in `edit-modes.js`, exclusive with Edit,
  offered when `canEditNow()` is false and the world is connected. It selects
  with `pickEditSelection` over `visibleHits(…, { includeHidden: false })`;
  clicks never send `activate`; triggers stay as outside Edit mode; **pointer
  lock is suspended as in Edit mode** (`usePointerLock`, §2.2), so the picker's
  `clientX/Y` is the real pointer. Its panel
  is read-only: name, Copy or Duplicate's refusal reason, the credit (K2,
  claimed wording), the behaviour's summary (template name or "custom graph",
  its grants by name where the world has them, enabled or not), and the note
  (K9). Leaving the world, or the world's `canEdit` turning true, leaves
  Inspect.
- **K5, Copy (CP-L2).** A pure module, `apps/client/src/copy-paste.js`.
  `copyObject(node, source)` runs `duplicateRuleProblem` and
  `buildDescriptor` at click time (exported from `edit-duplicate.js`, whose
  other change is K3's `atriumProblem`) and returns a snapshot `{ descriptor,
  sourceId, source: { origin, baseUrl, wsUrl, address, world } }` (`world` is
  K1's, or `null`). Paste works on a `structuredClone` of it, so nothing a
  paste does reaches the clipboard (a shallow freeze wouldn't protect it).
  Inspect can't pick a hidden object, and an object hidden after it was
  selected can still be copied; either way K6 makes the paste visible., or Duplicate's
  refusal. Copy is offered in Inspect and in Edit mode.
- **K6, Paste.** `preparePaste(clipboard, { name, position, destOrigin, date })`
  returns `{ ok, descriptor, bytes, notes }` or a refusal, and never changes the
  clipboard:
  1. the name: the original's if it's free in the destination, else `copyName`;
  2. the translation: x and z from the palette's spot ahead
     (`palettePlacement`), **y the original's own** (the palette's spot is on
     the ground, §2.9, and an object's origin needn't be at its base); rotation
     and scale kept;
  3. a new `objectId` (`withNewObjectId`);
  4. `extras`: `__atrium_visible` removed (a paste is always visible, §2.1);
     in `extras.atrium`, **only the keys Atrium defines are kept** (`objectId`,
     `teleporter`, `model`, `animation`, `behavior`, `origin`, `copiedFrom`),
     and any other is dropped and named in the notes, so a hostile world can't
     plant a key a later round gives meaning to. Other `extras` are content
     and travel as Duplicate's do;
  5. the behaviour per K7;
  6. URLs per K8;
  7. the credit per K2;
  8. `addMessageBytes` against `MAX_ADD_BYTES`, then `add-spec.js` (A7), then
     `atriumProblem`.
  
  **`app.js` gives paste its own answer branch,** `request.paste`, as the pad
  and model forms have theirs (§2.9), and registers the add with Undo:
  - refused: "Couldn’t paste: <the server's text>", nothing recorded, the
    clipboard unchanged;
  - refused for "already in use" (another tab took the name): one retry with
    the next `copyName`, as the palette's retry;
  - `unknown` (the world went away while it was pending): "Couldn’t paste: the
    world did not answer", through `orphanAddError`'s wording;
  - accepted: the paste is selected, as Duplicate's copy is.
  
  Paste is offered in Edit mode only. Undo's label for it is the add's ("Undo
  add <name>"): stated, not changed.
- **K7, behaviours (CP-L5 (c)).** `preparePaste` takes the destination's
  `worldId` and a set `destIds`: every `extras.atrium.objectId` in the
  destination's SOM, plus every one the Undo stack's entries can restore.
  1. **Same world** (`source.origin` is the destination's origin and
     `source.world.id` is the destination's `client.world.id`, both
     non-null): `remapBehaviorTargets(behavior, sourceId, copyId)` and nothing
     else, as `prepareDuplicate`.
  2. **Another world** (anything else, an unknown world id included):
     `remapBehaviorTargets` first, then `enabled: false`, then each id in
     `nodeMap` (from entry 1), `targets`, `animations[].object` and
     `template.params.target` that is in `destIds` is replaced through one
     map from old id to `newObjectId()`, so one id gets one replacement
     everywhere; every other id is kept as it is. If any was replaced, the
     notes carry CP-L5's sentence.
  
  The result must pass `behaviorCheck` with the copy's id; if it doesn't, the
  paste is refused (it can't be a legacy value: Copy ran `atriumProblem`).
  **`enablePromptText`** (`graph-import.js`) names a grant whose id isn't in
  the world as "an object not in this world", and leaves out "It can also
  change: …" when there are no grants, so the question reads right.
- **K8, URLs (CP-L6 (a)).** At Paste, when `source.origin` differs from the
  destination's (a same-origin paste changes neither):
  - a root-path `extras.atrium.model.url` is resolved with
    `resolveModelUrl(url, source.baseUrl)` (which keeps it on the source's
    origin, §2.8), and the result must pass `modelUrlProblem`; otherwise the
    paste is refused with that reason's text (`modelReasonText`): `url-scheme`
    for an `http:` source, `url-length` if it's grown past 2,048;
  - a path `teleporter.destination` becomes
    `resolveWorldAddress(destination, source.wsUrl)`, which must be non-null
    and at most 2,048 characters, or the paste is refused. **`""` (accepted by
    the server, a pad to nowhere) is kept as it is.** A `ws(s)://` destination
    is kept as it is. A destination is a path, so the query and fragment that
    `resolveWorldAddress` drops (`wsUrl.js` L199) carry nothing;
  - **a model on a host that isn't the destination's asks first:** "This
    model is loaded from <host>. Pasting it makes your browser, and your
    visitors', fetch from there. Paste?", through the same injected
    `confirm` the Behaviour panel uses (declined means nothing sent).
- **K9, the note (CP-L7 (a)).** The text in the Inspect panel and beside the
  world browser's Public/Private toggle; the models-by-url host note in the
  Inspect panel.
- **K10, what doesn't change:** `add`, `send`, `remove` and their rules
  (beyond K3); Duplicate's and Undo's rules and canonical form; the behaviour
  rules; the model fetch; A5 (avatars); R6's version-skew check (a paste is a
  world `add`, so a stale tab can't paste, and a `3fcc296c` tab's `ingestNode`
  keeps the new `extras.atrium` keys, so no `addFields` bump is needed:
  fresh-agent check).

## 5. Tests and proofs
- **Run on today's code first, and keep the failures in the handoff:** K1's
  hello test and K3's vectors on `3fcc296c`.
- **The credit vectors,** both suites: each key's accepted form, each refusal
  (a wrong type, an extra key, a missing required key, 256 + 1 and 2,048 + 1
  characters, a malformed date or id), and a node with both keys.
- **A server test file, port 0, through the real `attachSessionHandlers`:**
  - K1: an owned world's `hello` carries `world.id` and `owner` with the
    current username; with `db: null`, `owner` has an id and no name; a file
    world's carries no `owner`; the schema accepts all three, and the existing
    schema-validating tests (§2.4) pass unchanged;
  - K3: a world `add` with a valid credit is accepted, broadcast and saved,
    survives `serialize` → `createWorldFromDocument`, and a `send` can't
    change it; each malformed credit is refused and nothing is broadcast;
  - **two worlds, end to end:** a visitor's client in world A copies an object
    (with a model, a pad, a self-only behaviour, and a behaviour aimed at
    another object of A's in turn), teleports to its own world B, pastes; B's
    next joiner sees the copy with K2's credit, a new `objectId`, and the
    behaviour disabled, remapped, its other reference unchanged; Undo removes
    it. **The hostile case:** A's behaviour is aimed at the id of an object in
    B; after the paste, enabled, it can't write to that object (the id was
    replaced), and the notes said so.
- **`apps/client` (`copy-paste.js`, pure):**
  - the snapshot: a change to the original, and a replaced SOM, after Copy
    leave the clipboard unchanged; a failed paste leaves it unchanged;
  - K2's creator rule: a palette cube (the owner), a copy of a copy (`origin`
    unchanged, `copiedFrom` replaced), a source with no K1 (ids omitted), a
    library model (`"Library"`, and not for an `/assets/library/` URL on
    another host);
  - **K7, per GR2-M4,** for each of: `nodeMap` of length 1, 2 and 3; literal
    and wired pointers; an `animations` entry for the object and for another; a
    template targeting the object and another; `targets` empty and not; and
    for each of three cases: **same world** (grants and enabled state kept, as
    Duplicate), **another world with no match** (every other id unchanged,
    disabled), **another world with a match** (that id replaced at every place
    it appears by the same fresh id, the others unchanged, the note present).
    A match counted from the Undo stack alone is replaced too; an unknown
    source world id is treated as another world. Each result passes the real
    `behaviorCheck` with the copy's id, and every index still binds to the
    entry it bound to before (a replaced entry stays at its index);
  - **a template aimed at an object the destination doesn't have** opens in the
    Behaviour form with "Choose a target…", and re-aiming it at a destination
    object and saving gives a value `matchesTemplate` accepts;
  - K8: same origin (nothing changes); another origin, `https` (absolute,
    revalidated); another origin, `http` (refused, nothing sent); a path pad
    (absolute `ws(s)://`); a `ws(s)://` pad (unchanged); a hostile
    `https://evil.example/assets/library/x.glb` (not "Library");
  - K1's client check: a `hello.world` with an oversized name, a non-string
    id, or an extra key gives `client.world === null`, and a paste from it
    carries `{ server, at }` only; `client.world` is reset at disconnect;
  - K2's fill: an existing `origin` without `creator` is carried unchanged; a
    malformed existing credit is replaced and noted;
  - K6's `extras`: `__atrium_visible: false` and an unknown `extras.atrium` key
    are gone from the paste, other `extras` kept; y is the original's;
  - K8: also `""` kept, a destination resolved past 2,048 refused, a model URL
    resolved past 2,048 refused with `url-length`'s text, and the other-host
    question declined (nothing sent) and accepted;
  - K7's prompt text with empty grants, and with a grant not in the world;
  - names: free, taken, and no free name;
  - the size: a copy at the cap without its credit is refused once it has one.
- **`app.js`'s paste branch:** refused, "already in use" with its one retry,
  `unknown`, and accepted, each with its text (the wiring tests read `app.js`
  as text, as the existing ones do).
- **Inspect (`app.js` glue, as far as the existing client tests reach):** a
  hidden object isn't picked; a click doesn't send `activate`; pointer lock is
  off while Inspect is on; Copy's refusal reason is Duplicate's; the panel's
  text is set with `textContent`.
- **Proofs** (each break made, the named tests seen failing, the file restored
  from a saved copy):
  - (p1) K7 stops replacing ids that match the destination: the "match" tests
    and the end-to-end hostile case fail; (p1b) K7 replaces every foreign id:
    the "no match" tests fail;
  - (p2) K8 resolves against the destination's base: the cross-origin tests fail;
  - (p3) K3's check removed on the server: the server's malformed-credit tests
    fail;
  - (p4) the clipboard holds the live node: the snapshot tests fail;
  - (p5) Inspect with `includeHidden: true`: the hidden-object test fails.
- **The operator's DEV acceptance:** signed out, in the commons, Inspect
  `crate-01`: the panel, its credit-less state and the note; Copy. Sign in,
  teleport home, Edit, Paste: the crate appears ahead, with a credit naming the
  commons' owner; Undo removes it. A pad copied from a friend's world leads
  where it did. A button whose template opens a door in the friend's world
  arrives disabled; in the Behaviour panel it says "Choose a target…", and
  re-aimed at one of your objects and enabled, it works.
  **The DEV commons must have an owner** for the credit to name one (not
  checked from here: the operator confirms it, or the acceptance expects no
  `creatorName`).

## 6. Worker rules and release path
As `richer-add` (`PREBRIEF-richer-add.md` §6), with these specifics:
- **Five commits, each runnable:**
  0. **K0 (PC (b)):** `maxPayload: MAX_PAYLOAD_BYTES` on `createWorldHost`'s
     server (`world-host.js` L46; the constant is `session.js` L31's, which gains an `export`),
     and a test through `createWorldHost` on port 0: a message over 1 MiB
     closes the socket with 1009 and changes nothing, and one just under is
     handled. It fails on today's code first. Before the round's DEV deploy the
     operator checks whether the host's proxy caps WebSocket frames, and says;
  1. K2–K3: the credit vectors, both checks, their unit tests;
  2. K1: `hello`, its schema and protocol tests, `AtriumClient`, the server
     test file's K1 part;
  3. K5–K8: `copy-paste.js` and its tests, the `edit-duplicate.js` export;
  4. K4, K6's and K9's `app.js` and `index.html` glue, the end-to-end tests,
     the full suites, proofs (p1)–(p5) and the handoff.
- **Files:** `packages/server/src/world-host.js` (K0), `send-policy.js`,
  `session.js`;
  `packages/protocol/src/schemas/hello.server.json`;
  `packages/client/src/AtriumClient.js`; `apps/client/src/copy-paste.js` (new),
  `edit-duplicate.js` (the `buildDescriptor` export and K3's `atriumProblem`),
  `graph-import.js` (K7's prompt text), `edit-modes.js`, `app.js`,
  `apps/client/index.html` (the Inspect toggle and panel); `tests/fixtures/credit-vectors.json` (new);
  `devtasks/spike-richer-add/p6-db-survey.mjs` (below); test files under
  `packages/*/test/`, `packages/*/tests/` and `apps/client/tests/`. **No other
  file;** if one must change, stop and ask.
- **`p6` gains counters** for this round, and its stale heading is fixed
  (passdown §5): behaviours by kind (self-only, with foreign references), model
  URLs that are root paths, pad destinations that are paths, and objects
  already carrying `origin` or `copiedFrom` (expected 0). They say how much K7
  and K8 touch on PROD; the operator runs it before the PROD deploy, as last
  round (the host commands, with real paths, come with the round's release
  notes).
- **A new check must fail on today's code** before its PASS counts. **Server
  test files one at a time,** each under `timeout 180`, new tests on port 0.
- **Release:** a server, protocol and client round. A rollback stores nothing
  to undo: a credit is plain `extras.atrium`, which `3fcc296c`'s server accepts
  unchecked (§2.6), and the old client ignores `hello.world`.
- **Never push to `main` between the release merge and PROD `COMPLETE`.**

## 7. Review log
- **Rev 1.2** (2026-11-06, afternoon): the operator's decisions recorded (the
  status line). **CP-L5 changed after discussion:** the operator asked why
  kept ids gain nothing from a friendly world and whether trust could keep
  them; Claude's answer was that a foreign id reaches nothing in another world
  and only matches yours on purpose, so (c) keeps every id except those, and
  same-world pastes keep everything, as Duplicate. Rev 1's same-world rule
  (drop grants even in one world) was wrong and is gone. Verified for (c): no
  world template or seed carries object ids; the Behaviour form's "Choose a
  target…" for a target not in the world; no graph operation reaches the
  network. K7, §5's tests, proof (p1) and the DEV acceptance follow.
- **Rev 1.1** (2026-11-06): a fresh Claude agent checked Rev 1 against the
  code (it hadn't written it; it traced the flows and wrote two probes in a
  scratch directory). 58 of 67 §2 facts confirmed. Claude reproduced each
  finding before taking it. Taken:
  - **beyond this round:** PROD's path has no 1 MiB cap (`world-host.js` L46;
    the probe rerun by Claude: a 1.5 MB `add` accepted). §2.6 corrected, and
    **PC** put to the operator;
  - **must-fix:** K1's owner without a name (test worlds with `db: null`), and
    its schema's id form; K2's contradictory key rules, now a table with the
    fill order; the client checks `hello.world` itself and drops bad values
    rather than failing the paste; §6's `edit-duplicate.js` entry;
  - **should-fix:** paste gets its own answer branch (the generic one has no
    `unknown` text and no retry for it); y is the original's; Inspect suspends
    pointer lock; the enable question with no grants, and "asks first" stated
    as it is; unknown `extras.atrium` keys and the hidden marker dropped at
    paste; K8 through `resolveModelUrl`, every refusal reason, `""` kept,
    lengths, and the other-host question made a real question;
  - **corrected facts:** the client has no animation check; no `open` world
    outside tests; no `model` send leaf; graph import doesn't limit grants; the
    refusal texts' branches; `withNewObjectId`'s lines; `/apps/client`; the
    exposure argument; no load healing for a credit; Undo's label.
  
  Confirmed sound by that check: Copy → teleport → Paste → Undo → Redo (the
  credit and id survive Redo); Duplicate and Undo of a paste; R6 needing no
  bump; no test asserting the server hello's exact keys.
- **Rev 1, DRAFT** (2026-11-06, against `f286d283`): carved out of
  `PREBRIEF-richer-add-copy.md` Rev 0.4 after `richer-add` shipped. Every cited
  line rechecked. New facts: pad destinations resolve against the current
  world (§2.8; CP-L6 widened); the address can't name every world's owner and
  isn't stable (§2.4; CP-L3 (c) now with `hello`); ids are per server (the
  credit's `server`); a paste lands on the page's own server on PROD (§2.5).
  CP-L8 added. **Still to come:** a fresh-agent check of this draft, the
  operator's decisions, and one ChatGPT review.
