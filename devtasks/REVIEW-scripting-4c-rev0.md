# Atrium scripting-4c pre-brief review

Verdict: CHANGES REQUESTED — Rev 0 is directionally sound, but I recommend addressing two must-fix issues before finalizing it.

Reviewed: [PREBRIEF-scripting-4c.md — Draft Rev 0](https://github.com/joshmaurice/atrium/blob/ec9ebc1fff1d4e563252883bfb8b91912e478761/devtasks/PREBRIEF-scripting-4c.md?utm_source=chatgpt.com).

I compared it against the implementation baseline `71b6e40b`, the 4b-2 pre-brief, the Phase 3 design, and the signin-sync passdown. This was a read-only source review through GitHub. I couldn't execute the suites because the local environment couldn't reach GitHub for cloning.

## Must-fix

### M1. A visitor's activation can disappear while the elected host is loading

References: §4 AC3–AC5, §6 AC3/AC5; `AtriumClient.js:752–774, 1147–1180`; `runner.js:98, 520–540`; `session.js:718–725, 803–820`.

The server assigns `scriptHost.sessionId` during the owner's `hello`, before the owner's world has finished loading. The actual sequence is:

1. The owner connects and is elected script host.
2. The server starts serializing the world for `som-dump`.
3. A visitor sends a valid `activate`.
4. AC3 sees an elected host with an OPEN socket and forwards the message.
5. The host's client receives `activate`, but its runner isn't enabled until `world:loaded`.
6. AC5 drops it. The visitor receives no error, because the server considered forwarding a success.

There's a second path to the same result: `AtriumClient` dispatches WebSocket messages asynchronously, so an `activate` can be processed while `_onSomDump()` is still awaiting `io.readJSON()`.

This isn't a malformed-client scenario. It can happen with ordinary browsers during world loading.

Recommendation: Make host readiness part of the delivery contract. Either keep the host ineligible for forwarding until its runner is ready, with an explicit readiness acknowledgment, or define a bounded host-side queue that holds forwarded activations until `world:loaded`. Specify what happens if loading fails or the host disconnects.

Add a test that deliberately pauses the host's world load, sends an activation, then resumes loading. The test must verify the specified delivery or refusal behavior—not silently lose the request.

### M2. The `worldPosition` move needs an explicit application dependency

References: §4 AC2, §8 step 2; `apps/client/package.json`; `apps/client/src/world-position.js`.

The pre-brief requires moving `worldPosition` into `@atrium/som` and making `apps/client/src/world-position.js` re-export it.

However, `apps/client/package.json` currently declares only `@atrium/behaviors` and `@atrium/client` as direct dependencies. It does not declare `@atrium/som`.

The browser import map already provides `@atrium/som`, so the web page may work. But Node-based app tests importing `world-position.js` won't necessarily resolve that package under pnpm's strict dependency layout.

Recommendation: Add `@atrium/som: workspace:*` as a direct app dependency, update the lockfile, and include those files in the permitted scope. Alternatively, explicitly choose a resolution path that doesn't introduce an undeclared dependency.

A focused test must import `apps/client/src/world-position.js` in the same environment the normal app test suite uses.

## Should-fix

### S1. The handover test expects an interval that doesn't exist

References: §6 AC3; `session.js:481–490, 498–547`.

The test says that when a host disconnects, an activation in the same tick receives `NO_SCRIPT_HOST` until another owner is granted the role.

But `cleanupSession()` invokes `handOverScriptHost()` synchronously. Once the departing host has been removed, the eligible successor is granted the role in the same call stack.

Ordinarily, an activation received before cleanup may go to the old host; one received afterward may go to the new host. There is no guaranteed externally observable no-host interval between removal and election.

Recommendation: Test the real invariant instead: no activation is forwarded to an ineligible or closing socket, no activation is duplicated across hosts, and every forwarded activation carries the current generation. Where no eligible successor exists, require `NO_SCRIPT_HOST`. Avoid asserting a transient no-host state during synchronous handover.

### S2. Reconsider Q3's acceptance of stale host tabs

References: §5 Q3; §4 AC4; `hello.client.json` and `session.js:464–490`.

A 4b-2 tab advertises `scriptRunner: 1`, just as a 4c tab would. The server can elect that older tab, which silently ignores all forwarded `activate` messages.

The pre-brief describes this as a one-deploy-window limitation, but an old browser tab can remain open indefinitely. A newer owner tab could connect and still lose the election to the old one.

I recommend capability versioning now. Change to `scriptRunner: 2` for a client that actually understands forwarded activation, and make the server's eligibility policy explicit. Merely preferring version 2 would not solve the case where only an old owner tab is present.

The simpler fallback is to accept the limitation explicitly, but I would at least require a browser check that documents what visitors observe with an old host.

### S3. The activation refusal map needs per-connection ownership

References: §4 AC4, §9; `AtriumClient.js:595–698, 1909–1914`.

The new `seq → nodeName` map is bounded to 16 entries, but its lifecycle isn't specified.

`AtriumClient` resets `_sendSeq` to zero on a new connection. If activation records survive a reconnect, a new activation can reuse a seq belonging to a previous world. A refusal could then be associated with the wrong node.

Recommendation: Put activation records on the existing connection record, or clear the map on every connecting/disconnect lifecycle path. Test reconnect after an unanswered activation and verify that the new connection's refusals identify only its own nodes.

### S4. Pointer-lock targeting deserves a stronger acceptance rule

References: §2 P17, §5 Q2, §6.1.

The pre-brief correctly observes that pointer-locked clicks currently aim using `clientX/Y`, which doesn't necessarily match the screen center.

For 4b-2 this was a host-only interaction defect. In 4c it becomes a visitor-facing feature: clicking at the visible center of the scene may activate an unrelated target or nothing at all.

I lean toward fixing this in 4c, since the affected hit-selection function is already in scope. At minimum, add one browser acceptance case with pointer lock enabled. If the click fails to target the crosshair object, I wouldn't leave it as a merely recorded issue.

## Nits and clarifications

N1 — `PERMISSION_DENIED` covers two different conditions. Under AC-L5/AC-L6, both "no avatar" and "too far" lead to the same page notice, "Move closer to use this." That's misleading when the avatar failed to register. A more neutral message or an explicit no-avatar notice would be preferable.

N2 — The distance isn't a security boundary. The pre-brief explains this well in P8. I would preserve that warning prominently in the implementer's brief rather than letting the 10-meter rule be described as preventing a determined malicious visitor from triggering distant objects.

N3 — A successful forward isn't a successful execution. The no-acknowledgment policy is acceptable for this phase, but document the distinction clearly. Even after M1 is fixed, an engine can be disabled between validation and execution, and the server does not confirm an effect occurred.

## Views on AC-L1–AC-L8

| Decision | Recommendation               | View                                                       |
| -------- | ---------------------------- | ---------------------------------------------------------- |
| AC-L1    | (a) One round                | Agree. Six commits is a reasonable seam.                   |
| AC-L2    | (a) Fixed 10 m               | Agree. Defer per-behavior configuration.                   |
| AC-L3    | (a) Same rule for host       | Agree. Consistency across tabs matters.                    |
| AC-L4    | (a) Different bucket charges | Agree. Refusals shouldn't consume the shared world budget. |
| AC-L5    | (a) `NO_SCRIPT_HOST`         | Agree. Distinct machine-readable error.                    |
| AC-L6    | (a) Transient notices        | Agree, with N1's qualification.                            |
| AC-L7    | (a) Node name                | Agree. Consistent with existing SOP addressing.            |
| AC-L8    | (a) No carried polish        | Agree. Keep the round focused.                             |

For the open questions, I agree with Q1 (measure from the avatar/camera in ORBIT) and Q4 (object origin rather than bounds). I would strengthen Q2 as noted in S4, and reconsider Q3 as noted in S2.

## What looks ready

Several parts of the pre-brief deserve retaining unchanged.

The shared `selectTargetFor` rule addresses a real semantic mismatch: the host previously walked to the first live engine, while visitors cannot know which engines are running. Using stored, enabled behavior data gives both sides a consistent decision.

The nested-object distance correction is also important. The existing `worldPosition` implementation accounts for parent translation, rotation, and scale. Using `getNodeTranslation()` would produce incorrect admission decisions for objects inside transformed groups.

Finally, the rate-limit design is sensible. Charging every schema-valid attempt against the session bucket before expensive lookups protects server work, while charging the world bucket only for eligible forwards prevents one far-away visitor from exhausting everyone else's shared allowance.

## Overall recommendation

I would request a Rev 1, with M1 and M2 corrected and S1–S3 explicitly settled. S4 could be accepted as a documented limitation only after a pointer-lock browser test.

I don't see a reason to split 4c into two implementation rounds, reopen the five-template behavior format, or redesign the activation protocol. The proposed division of responsibilities—server validates proximity and eligibility, owner browser runs the behavior, server validates resulting mutations—is appropriate for the current phase.

The biggest remaining risk is silent event loss, not unauthorized mutation. Fixing the host-readiness seam is the most valuable change before implementation.