# Atrium scripting-4c — second outside review

Reviewed: [PREBRIEF-scripting-4c.md, Rev 1.1](https://github.com/joshmaurice/atrium/blob/a088f4f4b80e80ba92ed28adaf494a88b6c4e498/devtasks/PREBRIEF-scripting-4c.md?utm_source=chatgpt.com), commit `a088f4f4b80e80ba92ed28adaf494a88b6c4e498`.

Verdict: CHANGES REQUESTED — one new compatibility issue needs resolution before FINAL.

The good news is that Rev 1.1 substantially addresses my previous review. The readiness handshake, capability-based host election, connection-scoped refusal tracking, and corrected pointer-lock behavior are well motivated. I don't see a need to reopen any of the operator-approved AC-L1–AC-L8 decisions.

I found one new problem introduced by the capability change, affecting Atrium's cross-server connections.

## Must-fix

### M1. `scriptRunner: 2` breaks connections to older Atrium servers

Pre-brief: §4 AC1, AC4; §5 Q3; §6 AC1/AC4.

Code baseline:

- `packages/client/src/AtriumClient.js:733–748`
- `packages/protocol/src/schemas/hello.client.json:29`
- `packages/protocol/src/index.js:54–68`

Rev 1 changes the client's outgoing `hello` to advertise `scriptRunner: 2`. The new server schema accepts both 1 and 2, which correctly allows old clients to connect to new servers.

But compatibility also matters in the opposite direction.

An older Atrium server uses the existing schema:

```
"scriptRunner": {
  "type": "integer",
  "const": 1
}
```

Consequently:

1. A visitor running the new 4c client navigates to an older Atrium server.
2. The client sends `hello` with `scriptRunner: 2`.
3. The older server rejects the handshake as an invalid protocol message.
4. The visitor cannot connect, even though cross-origin visitors are supposed to be anonymous and don't need to host scripts.

This affects the cross-server navigation functionality, which is an existing Atrium feature, not a new requirement introduced by this review.

Recommended correction: Define a backward-compatible capability policy. For example, omit `scriptRunner` for connections to another origin, since those clients cannot become an authenticated script host there anyway. Keep `scriptRunner: 2` for connections to the account server where host election is possible.

That requires passing the relevant origin information from the app into the renderer-neutral `AtriumClient`, or another explicit compatibility mechanism.

Add a real-socket test using the unchanged `71b6e40b` server protocol validator. Verify that a new client can join as an anonymous cross-origin visitor, while still advertising version 2 to a new same-origin server.

This correction need not change AC-L1–AC-L8 or the new server's election policy.

## Should-fix

### S1. Clarify the `activate()` readiness test

Pre-brief: §4 AC4, §6 AC4.

Code baseline: `packages/client/src/AtriumClient.js:1127–1180`.

AC4 correctly requires both `session:ready` and `world:loaded` before `activate()` sends anything.

However, the AC4 test description says that activation before `session:ready` returns null, and after it sends the exact message.

Those events are not equivalent. `session:ready` occurs when `hello` is processed; `world:loaded` follows parsing and installing `som-dump`.

The tests should explicitly cover three states:

1. Before `session:ready`: no send.
2. After `session:ready`, before `world:loaded`: no send.
3. After both: send succeeds.

This prevents a future implementation from satisfying the test while violating AC4's actual requirement.

### S2. Specify the setup order for the held-load integration test

Pre-brief: §6 AC5.

Code baseline: `packages/server/src/session.js:803–822`.

The new test is a substantial improvement over the previous plan. Wrapping the real world's `serialize()` method with a test-controlled promise avoids introducing a production-only test seam.

One detail needs specifying: the visitor must finish joining before the test blocks serialization for the owner's connection.

Otherwise, if the shared world's `serialize()` is blocked for both clients, the visitor cannot finish loading either.

I recommend spelling out this order:

1. Establish a visitor session and wait for its world to load.
2. Install the serialization hold.
3. Connect the owner, allowing `hello` and host election but withholding `som-dump`.
4. Send the visitor's activation and verify `NO_SCRIPT_HOST`.
5. Release serialization, wait for `script-ready`, and verify successful forwarding and execution.

The current test description is implementable, but making this sequence explicit will avoid a fragile or accidentally ineffective test.

## Nit

### N1. Make the `script-ready` validation direction explicit

Pre-brief: §4 AC1.

Code baseline: `packages/protocol/src/index.js:54–67`.

AC1 compiles `script-ready` under a directionless validator key while describing it as client-to-server only.

Currently, the validator appends `:client` or `:server` only for message types in its directional list.

If `script-ready` remains directionless, `validate('server', scriptReadyMessage)` will also accept it.

This does not create a practical authorization problem—the server never sends such a message—but the protocol declaration would be cleaner if it were explicitly directional.

Either add it to the directional list and compile `script-ready:client`, or document that the direction restriction is enforced by dispatch rather than schema validation.

## Readiness and election assessment

The two largest changes deserve explicit conclusions.

### 1. `script-ready` — acceptable design

The cooperative readiness model is appropriate for Phase 3.

The server isn't trusting an anonymous visitor to declare the host ready. It accepts readiness only from the session it already elected, for the current `hostGen`. That browser is the owner's authorized execution environment.

The intended readiness transitions also match the existing lifecycle.

| Transition                                           | Rev 1.1 contract                          | Assessment                                      |
| ---------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Initial election during `hello`                      | Set `ready = false`                       | Correct                                         |
| Handover grants a successor                          | Set `ready = false`, increment generation | Correct                                         |
| Handover finds no successor                          | Set `ready = false`                       | Correct                                         |
| Current host sends current-generation `script-ready` | Set `ready = true`                        | Correct                                         |
| Non-host or stale-generation readiness               | Ignore                                    | Correct                                         |
| Host disconnects or is terminated                    | Cleanup removes or replaces role          | Correct, provided the OPEN-socket check remains |
| Host remains connected but never loads               | Continue returning `NO_SCRIPT_HOST`       | Acceptable documented limitation                |

I checked the baseline's role transitions in `session.js:450–490`, `498–547`, `718–725`, and the connection cleanup paths. There isn't another existing path that grants the host role.

The combination of explicit readiness reset and the `OPEN` socket check avoids the original silent-forwarding problem.

One accepted consequence remains: an elected version-2 owner whose page stalls indefinitely can prevent a later owner session from becoming host. That matches the existing Phase 3 policy of not moving a live session's role without disconnecting it. I wouldn't expand 4c to solve that now.

### 2. `scriptRunner: 2` — correct election policy, incomplete compatibility policy

Requiring version 2 in both the inline `hello` election and `canRunBehaviors()` closes the stale-version problem that I raised in Rev 0.

An older owner page can still edit, cannot be elected host, and receives no forwarded activations. That is correct.

The two separate mutation proofs in §6 AC3 are also worthwhile: they prevent an implementation from changing one eligibility check while overlooking the other.

The only missing part is the older-server compatibility identified in M1.

## Disposition of all nine Rev 0 findings

| Previous finding                       | Rev 1.1 disposition                                                | Result                                    |
| -------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------- |
| M1 — activation lost while host loads  | `script-ready`, server readiness gate, held-load test              | &#x20;Resolved at specification level     |
| M2 — missing `@atrium/som` dependency  | Direct dependency, lockfile, app import test                       | &#x20;Resolved                            |
| S1 — incorrect handover window         | Tests real transition and readiness interval                       | &#x20;Resolved                            |
| S2 — stale host tab                    | Version-2 eligibility, old version still accepted as visitor/owner | &#x20;Resolved, with new compatibility M1 |
| S3 — refusal map spans connections     | `record.pendingActivations`, reconnect test                        | &#x20;Resolved                            |
| S4 — pointer lock                      | Center aim, correct event target, browser acceptance               | &#x20;Resolved                            |
| N1 — misleading no-avatar notice       | Separate page notices, neutral server refusal                      | &#x20;Resolved                            |
| N2 — distance mistaken for security    | Explicit implementation rule in §8                                 | &#x20;Resolved                            |
| N3 — forwarding mistaken for execution | AC3, AC5 and §9 document limitations                               | &#x20;Resolved                            |

All nine findings have been addressed in the revised document. None of the original findings remains unresolved as originally stated.

## Verification and test execution

Revision integrity verified.

I independently computed the pinned file's byte count and SHA-256.

60,214 bytes

`a8a84e922ef820e7f3fcd69bbbb8f65db15004d262b37b06827309c8e756a905`

Both match the supplied values.

The GitHub comparison confirms that the commits from `71b6e40b` through Rev 1.1 affect only `devtasks/`. Rev 1.1 itself changes just the pre-brief.

I attempted to access the repository with Git in the container, but the container could not resolve `github.com`. Consequently, I reviewed the source through GitHub's connected API and did not run the repository test suites. My assessment is of the proposed contract, not verified implementation behavior.

## Final recommendation

Rev 1.1 is substantially stronger than Rev 0, particularly around host readiness, compatibility with older clients, and deterministic testing.

I recommend one narrow Rev 1.2:

- Required: Resolve M1, the new client's compatibility with older cross-origin Atrium servers.
- Recommended: Clarify S1 and S2's test sequencing.
- Optional: Clean up N1's protocol direction declaration.

The nine original findings can be considered closed. The cooperative readiness design and version-2 host election are acceptable, and I see no reason to revisit the eight approved operator decisions.

Once the older-server compatibility issue is settled, I would expect this pre-brief to be ready for FINAL without another broad design review.