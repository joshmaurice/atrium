# Passdown 2026-09-27: worldload-address-sync complete; next is the cross-server pre-brief

## State

`worldload-address-sync` is merged to `main` and deployed to DEV and prod.
The spec is `devtasks/PREBRIEF-worldload-address-sync.md` (15 decisions).
The ghost-label DEV finding was fixed in `bac9622`, which adds a shared
`teardownWorld()` and a `connecting` handler to both apps, and the task was
closed out with `e66d99b`.

The next task is a pre-brief for cross-server connect. Its input is
`devtasks/Atrium-Passdown-2026-09-24-cross-server-findings.md`. **Verify all
code facts against current `main`.** The findings passdown was written
before worldload landed, so some of what it describes has changed.

## What worldload established that cross-server should build on

Read the pre-brief for the details. In short:

- **Connection records (#4, #9).**
  - Each `connect()` creates a record, and only the current record may act.
  - A superseded record is closed and silent. Its messages, errors, close
    event, and pending `disconnected` are all ignored.
  - Explicit `disconnect()` puts the record into a closing state that emits
    exactly one asynchronous `disconnected`.
  - Every `connect()` emits `connecting { sessionId, url, previousSessionId }`,
    and replacing a connection never emits `disconnected`.
  - `connect()` returns the `sessionId`, and every lifecycle event carries
    it.
  - `session:ready` carries `url`.
  - Cross-connect should be a `connect()` to another server's URL, and it
    gets all of this without further work.
- **World generation (#11).** Async world work (the som-dump read, static
  loads, external-ref fetches) commits only if its world is still current.
  Stale failures are silent too.
- **Asset base (#6).** Unless a caller passes an explicit `worldBaseUrl`,
  `connect()` derives it from the *connect URL's own* origin, with `wss:`
  mapped to `https:`. A cross-connect to server B therefore resolves assets
  against B. Cross-connect must never pass a base taken from a DOM field.
- **Addresses (#13).** The canonical world address is
  `/worlds/<username>/<slug>`, built by `buildWorldWsUrl`. `/public/` is kept
  as an alias. `/home/<userId>/home` still works on the server, but the
  client doesn't use it any more: auto-connect uses `/worlds/<username>/home`.
  Path segments are percent-decoded server-side (#10).
- **The World box (#4, #14)** is synced from `session:ready` and nowhere
  else. `AtriumClient` owns the authoritative connected URL, and whatever the
  user types in the box is only a pending destination.
- **Static loads are refused while a connection is live (#15).**

## Process lessons from this round

- **Check the base branch.** The first implementation branched from a stale
  commit (`de26d8b`) and silently lost Step 5 hardening and the Bug A/B
  fixes, which brought Bug A back on DEV. Every workflow branch's merge base
  must equal `origin/main` at kickoff.
- **The critic should check the pre-brief decision by decision.** Two #9
  requirements went through implementation and several review rounds
  unimplemented: the auto-connect comment rewrite, and the `connecting`
  listeners in both apps. The second of these caused the ghost-label bug.
- **Upload the pre-brief before a revision starts.** One amendment reached
  the pipeline only as a chat note. It worked out, but the critic checks
  against the repo copy.
- **`apps/client` and `tools/som-inspector` have no DOM test harness.**
  Anything that lives in app-level event wiring is only caught by the manual
  DEV checklist. Put every flow a change could affect on that checklist,
  including logout followed by login as another user.
- **DEV serves only the client paths.** `/tools/som-inspector/` and
  `/tests/fixtures/` 404 there. Inspector checks and fixture-by-URL checks
  have to be done locally, from a static server started at the repo root. If
  that server runs on the VPS, bind it to localhost and use an SSH tunnel.
- **A dropped `.atrium.json` can't resolve a relative `world.gltf`.** Only a
  config loaded by URL through the File box can. Write fixture checks with
  that in mind.

## Outstanding and deferred

- **Not acceptance-tested on DEV:** the SOM inspector (a local smoke test
  was deferred; do it the next time the inspector is touched), the
  `.atrium.json`/fixture flows, and the drop-while-connected refusal (#15).
- **Small deviation from the spec (#7, #12), not user-visible:**
  - both apps pass `client.worldBaseUrl || ''`;
  - with a falsy base, `loadBackground` falls back to the page URL instead
    of warning and returning.

  Clean this up when the renderer is next touched.
- **Explicitly out of scope, still open:**
  - refresh always returns to the home world;
  - where assets referenced by server-stored worlds should live;
  - whether usernames belong in world addresses;
  - removing the `/public/` alias;
  - switching automatically from a live world to a dropped file.
