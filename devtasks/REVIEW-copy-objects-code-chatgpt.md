`2971a440906487b6e3089755f7a96e93fe5daac3`

# Atrium `copy-objects` — Outside Code Review

APPROVE WITH NITS

Repository: `joshmaurice/atrium`\
Branch: `claude/copy-objects`\
Base: `ace29de`\
Reviewed tip: `2971a440906487b6e3089755f7a96e93fe5daac3`\
Review type: Read-only, source-only, with one isolated Node.js edge-case probe.

## Overall assessment

I found no confirmed must-fix defects in the implementation.

The principal security concern from my Rev 1.2 design review—foreign behavior references becoming valid after a destination object is restored—appears correctly addressed.

The implementation also follows the contract's major decisions on credit validation, world identity, server-relative URLs, Inspect mode, and the WebSocket payload cap.

The new tests are substantial, especially the adversarial two-tab and same-server cases. However, I could not independently run the project suites, and the page has not been exercised in a browser.

## Findings

### N1 — `address` permits text-direction controls that its display must escape

Severity: Nit / recommended contract hardening\
Status: CONFIRMED IN THE SOURCE

Locations:

- [`packages/server/src/send-policy.js:279–281`](https://github.com/joshmaurice/atrium/blob/2971a440906487b6e3089755f7a96e93fe5daac3/packages/server/src/send-policy.js?utm_source=chatgpt.com#L279-L281)
- [`apps/client/src/edit-duplicate.js:200–203`](https://github.com/joshmaurice/atrium/blob/2971a440906487b6e3089755f7a96e93fe5daac3/apps/client/src/edit-duplicate.js?utm_source=chatgpt.com#L200-L203)
- `apps/client/src/copy-paste.js:77–93, 427–444`

Both validators accept an `address` containing U+202E (right-to-left override), because they only prohibit characters below U+0021.

The fresh-agent fix makes `creditLines()` escape that character before displaying the address. That protects the current Inspect panel.

However, the stored value remains potentially misleading in any other consumer that forgets the presentation rule.

Recommendation: Yes, I would change K2's `address` form to exclude the same direction-control characters as `creatorName`, along with U+007F and U+2028–U+2029. Update both validators and the shared vectors.

This is not a release blocker: the current rendering path handles the accepted value safely.

### N2 — Valid dates in years 0001–0099 are incorrectly refused

Severity: Nit\
Status: REPRODUCED in an isolated Node 22 probe; CONFIRMED IN THE SOURCE

Locations:

- `packages/server/src/send-policy.js:271–276`
- `apps/client/src/edit-duplicate.js:193–198`

Both copies of `creditDateOk()` construct their validation date using:

```
new Date(Date.UTC(y, m - 1, d))
```

JavaScript interprets years 0–99 specially in `Date.UTC()`, mapping them to 1900–1999.

I ran the equivalent predicate locally under Node v22.16.0:

```
0001-01-01 false
0099-12-31 false
0100-01-01 true
1900-02-29 false
2000-02-29 true
2026-11-06 true
```

K2 describes `at` as a real date in `YYYY-MM-DD` format, which does not explicitly exclude years 0001–0099.

Recommendation: Construct the date with `setUTCFullYear(y, m - 1, d)` instead, and add shared vectors for early years.

This has no practical impact on contemporary Copy timestamps and does not create a server/client mismatch: both validators have the same limitation.

## Security and contract checks

| Area                       | Assessment                                   |
| -------------------------- | -------------------------------------------- |
| K0 — WebSocket payload cap | Correct in reviewed source                   |
| K1 — `hello.world`         | Correct in reviewed source                   |
| K2/K3 — Credit validation  | Consistent, subject to N1/N2                 |
| K4 — Inspect               | Source wiring consistent; browser unverified |
| K5/K6 — Copy and Paste     | Correct in reviewed source                   |
| K7 — Behavior isolation    | Correct in reviewed source                   |
| K8 — URLs                  | Correct in reviewed source                   |
| K9 — Visitor notice        | Present                                      |
| K10 — Existing behavior    | No incompatible change identified            |

### K7 — The previous must-fix is addressed

Status: CONFIRMED IN THE SOURCE

`apps/client/src/copy-paste.js:270–337` correctly distinguishes a same-world paste using both the normalized origin and the world ID.

For another-world paste:

- Self-references are remapped first.
- The behavior is disabled.
- Each distinct foreign ID receives a fresh ID.
- The same substitution is used in `nodeMap`, `targets`, `animations[].object`, and `template.params.target`.
- `nodeMap` positions are preserved.
- The original references are recorded in `copiedFrom.refs`.

A hostile server's `hello.world.id` cannot by itself impersonate the destination world across different origins: the source origin comes from the live connection URL. On the same Atrium server, different world IDs are correctly distinguished.

I also inspected the adversarial tests in `packages/client/tests/copy-objects-e2e.test.js`. They exercise restoration through both Undo and Redo, use the actual behavior runner, and assert that the restored destination object is not modified.

The additional same-server, different-world test directly addresses the fresh agent's finding.

No remaining K7 must-fix identified.

### K8 — URL handling

Status: CONFIRMED IN THE SOURCE

`copy-paste.js:339–379` resolves root-relative model URLs against the copied world's connection-derived base, not the destination or the File box.

It also handles the three pad cases: empty destinations, complete `ws(s)://` destinations, and relative paths.

The third-party model confirmation is based on the model's resolved origin, independently of whether the two worlds share a server. The Library classification uses the destination origin and `/assets/library/` prefix as specified.

I found no discrepancy requiring a change.

### K2/K3 — Credit checks

Status: CONFIRMED IN THE SOURCE

The server and client validators use the same field order, required fields, object checks, and bounds.

Their treatment of missing fields versus `null` also matches.

`copyObject()` skips the credit check without bypassing other Duplicate eligibility rules. `preparePaste()` replaces malformed credit, preserving valid historical reference entries where applicable.

The Copy date is captured in the snapshot rather than generated at Paste.

N1 and N2 are form-level refinements, not a disagreement between the implementations.

### K1/K0 — Handshake and payload boundary

Status: CONFIRMED IN THE SOURCE

`worldFromHello()` independently checks the received ID and owner fields. The client's world state is reset during connection changes, close, timeout, and disconnect.

The optional owner-name lookup in `session.js` is surrounded by error handling, so a missing database entry does not prevent the server from sending `hello`.

Both `createWorldHost` and the registry's refusal WebSocket server specify `maxPayload: MAX_PAYLOAD_BYTES` (1,048,576 bytes). I found no other uncapped `WebSocketServer` on the registry production path.

## Test assessment

The new tests cover the highest-risk cases well. Particularly valuable are the same-server hostile-world test, the cross-tab Undo/Redo tests, and the mutation proofs described in the handoff.

One qualification remains: `apps/client/tests/copy-objects-wiring.test.js` primarily checks source text and extracted functions. Those checks are useful for detecting missing wiring, but they cannot establish that browser pointer events, panels, selection outlines, and modal dialogs behave correctly together.

I recommend retaining the planned DEV browser acceptance before production.

## What I ran and couldn't run

I attempted the requested clone first:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium.git/': Could not resolve host: github.com
```

I then retrieved the pinned source through the GitHub connection, reviewed the implementation, pre-brief, handoff, and relevant tests.

Project test results independently verified: 0. I could not install dependencies or run the project's test files without a local clone.

The implementer's handoff reports 4,223 passing tests, zero failures and one named skip across 64 suites. I have not independently verified those counts.

The isolated Node 22 date probe above was executed; it does not substitute for running the repository's test suite.

## Final verdict

APPROVE WITH NITS.

I would not hold the implementation for either N1 or N2. Both can be addressed as small follow-up hardening changes, preferably before the release if convenient.

The key release condition is a successful DEV browser acceptance, since the UI integration remains unverified at runtime.

I found no source-supported reason to request a further K7 security revision.