# Atrium scripting-4d pre-brief review — Rev 1

**Verdict: CHANGES REQUESTED.** Rev 1 substantially closes the original design objections, notably the executable-identity gate, non-reused delay handles and clock contract. However, the revised write overlay can retain a speculative value after a failed send, the boundary accepts transform values the server expressly rejects, and rollback restoration can overwrite newer owner edits or be impossible without an authenticated write path. These are narrow specification fixes, not objections to the chosen architecture.

**Reviewed:** `joshmaurice/atrium` at `2bb7013efa9d84d9c0fd3128f9103080ea864e74` (`devtasks/PREBRIEF-scripting-4d.md`, **Rev 1**), its §0.1 and §11 revision table, the checked-in `REVIEW-scripting-4d-rev0.md`, `devtasks/spike-4d/r1-extension-collision.mjs`, `r2-clock-and-defaults.mjs`, and `README.md`. Compared the contract with the unchanged pinned behavior adapter/runner, `AtriumClient`, server send policy and world-load healer, and relevant vendored engine. **Cloned: NO.** I tried the clone first in this session:

```text
Cloning into 'atrium-4d-rev1'...
fatal: unable to access 'https://github.com/joshmaurice/atrium/': Could not resolve host: github.com
CLONE_EXIT=128
```

Used read-only pinned GitHub source access as directed. **Source-only review.** Node is `v22.16.0`, but `pnpm` is not installed and there is no clone. **I did not run** `pnpm install`, `r1`, `r2` or `node --test tests/*.test.js`; I cannot certify the stated 176 pass/1 skip or independently quote runtime output. The `r1` and `r2` files are reproducible probes *written and reportedly run by the brief's author*, not executions by this reviewer. Their reported outcomes in §2.5/README are consistent with the pinned source: the loader matches only `op` (`build/index.js:8503–8510`), the clock calls `performance.now()` (`:8667–8670`), `pointer/get` can produce NaN defaults (`:1566–1645`), and `onTick` initially emits NaN for `timeSinceLastTick` (`:1117–1148`). **Crucially, these probes confirm the OLD engine's faults; they do not verify the still-unimplemented Rev 1 fixes.** M2 is confirmed by inspection of existing client event shapes, not by `r1`/`r2` execution.

References below are to the Rev 1 pre-brief unless stated otherwise. **INFERRED** denotes analysis of the planned mechanism against source, *not a runtime reproduction of an implementation.* No code was changed, pushed or deployed.

## Rev 0 findings: closed / partly / not closed

| Rev 0 | Status in Rev 1 | Basis |
|---|---|---|
| **M1** Extension-qualified core op runs | **CLOSED at design level** | §0.1, G1, G-L3, G3: gate on `(op, extension)` and rewrite an unsupported declaration's `op` on a load-only copy *before* engine loading; registry allowlist remains. The vendor's core lookup and onStart/onTick lists read the renamed copy. G3 tests cover extension collisions and exact `KHR_node_selectability` control. See new **S1** for the stored-graph click predicate. |
| **M2** Own echo indistinguishable from remote set | **PARTLY CLOSED** | §0.1, G-L6, G4–G5: `origin`, `requestSeq`, per-key revisions and remote-precedence are the right fix for the reported `v1`/`v2` sequence. G4 fails to specify a send-failure/indeterminate-send disposition; **new M1**. |
| **M3** Throwing `performance.now()` test impossible | **CLOSED** | §0.1, G3: correctly narrows the contract to the clock observed by ops; accepts the engine's real internal clock read. `r2` reportedly demonstrates precisely that old limitation. |
| **M4** Reused delay id cancels new timer | **CLOSED** | §0.1, G3: monotonic, non-recycled IDs; live timer Map; stale ID no-op; injected timers, 17th `err`, and specific stale-handle fixture. |
| **S1** Invalid/default values escape into sends | **PARTLY CLOSED** | G4 properly rejects non-finite/malformed values before queue/overlay. But its rotation/scale constraints are weaker than the server's actual rules; **new M2**. |
| **S2** Node count is not a CPU-time bound | **CLOSED for this first cut** | G4/G7 adds a soft 8-ms stop between whole synchronous engine ticks, a rotating start, throttling visibility and 64-engine/p95 measurements (§6.1). It explicitly allows one complete tick over budget; no hard 8-ms latency guarantee is implied. |
| **S3** Sampled motion terminal state not guaranteed | **CLOSED** | G-L5 and G6 explicitly qualify last-value delivery by continued host ownership; tests interrupt at 1.9/1.99 seconds. |
| **S4** Import adversarial and ref handling | **CLOSED in principle, with a clarification** | G6 adds GLB checks, pre-conversion size/depth/count guards, typed-reference traversal and fail-closed mapping; §6 tests adversarial inputs. See **S3** for the potentially misleading `other`-reference exception. |
| **S5** No world-wide payload ceiling | **CLOSED in contract; tests incomplete** | G2/G7 adds 1 MiB UTF-8 of non-null stored leaf JSON and §6.1 measures real visitor downloads. §6 G2 omits direct add/Duplicate/Undo cap tests; **S2**. |
| **S6** Rollback silently destroys newer graphs/edits | **PARTLY CLOSED** | §8 adds before-rollback export, re-upgrade restoration and a rehearsal preserving an unrelated edit. The restoration still lacks owner authorization and same-leaf conflict rules; **new M3**. |
| **S7** `onStart` and select output warnings | **CLOSED as a warning contract** | G3's `graphReport`, G6's precise import/Enable notes and tests address both. First-enable confirmation remains an explicit operator choice (Q3 below). |
| **N1** Bytes vs UTF-16 characters | **CLOSED** | G1/G7 distinguish JSON string code units, UTF-8 world total, and raw imported bytes; multi-byte boundary vectors. |
| **N2** Fixture/survey reproducibility | **CLOSED** | §0.1, `spike-4d/survey/`, G8: pinned assets, scripts, hashes and per-fixture baseline. |

## New findings

### Must-fix

#### M1 — Overlay can keep a value for which no send was accepted or registered

**References:** G-L6(a), G4 `overlay`/`Unchanged`, §6 G4; [`packages/behaviors/src/runner.js:338–397`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/behaviors/src/runner.js#L338-L397); [`packages/client/src/AtriumClient.js:1354–1382`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/client/src/AtriumClient.js#L1354-L1382), `:2066–2070`.

**Scenario:** An engine enqueues a finite `v1`, so G4 adds a speculative overlay. An opportunity removes the queue entry and calls `client.sendField`. The real method **throws** if `_worldReady` is false; its `_wsSend` helper also silently does nothing when the socket is not `OPEN`, although `sendField` still returns a numeric sequence. A test seam may similarly return no seq. If no request is actually dispatched or no answer can arrive, the key is now neither queued nor associated with a sound pending acknowledgment. The overlay nevertheless remains, and the next `get → add → set` tick reads a value the server never held. The existing runner has no optimistic overlay, so this is a *new* 4d failure mode, not merely an inherited log omission.

The normal `connecting`/`disconnected` lifecycle clears everything, but the contract must not rely on an eventual close event to account for a failed send; in particular the programmatic opportunity and its error handling must be total. Numeric seq allocation is not proof the frame was queued to an open socket.

**Recommendation:** Require the send API to report whether it actually dispatched (e.g. `seq` only after a successful `OPEN` send, or an explicit result), or maintain an explicit failure path at the opportunity. On throw, closed-socket/no-send or non-numeric result, drop the matching overlay revision and tracked send record, log once, and avoid aborting other engines' ticks. At a disconnect/role loss, clear all pending overlays synchronously. Specify exactly when a numeric seq becomes associated with the queued write; never leave an overlay with neither a queued key nor an outstanding, settleable seq. If the client changes `_wsSend` semantics, preserve tests for existing edit call sites.

**Proving test:** Real runner and client: enqueue a value while enabled; make `sendField` throw `World not loaded`, then repeat with `_ws.readyState = CLOSING` (the real `_wsSend` silently skips). Verify no unhandled exception, no retained overlay, subsequent reads fall back to the SOM, and other engines still tick. Repeat for lights, animation keys and two producers. **INFERRED** from pinned source; proposed code does not exist.

#### M2 — Invalid-but-finite transforms are treated as valid speculative writes

**References:** G4 `Writes`, G-L6; §6 G4 and §6.1 check 2; [`packages/server/src/send-policy.js:1309–1330`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/server/src/send-policy.js#L1309-L1330) and module header lines 20–26.

**Scenario:** G4 admits any four finite rotation components and any three finite scale components. The server rejects a rotation unless it is a **unit quaternion** (norm tolerance 1e-3), and rejects a scale containing a zero/near-zero component (minimum magnitude 1e-6). A graph produces rotation `[0,0,0,2]` or scale `[0,1,1]`. Both pass the proposed runner check, enter the overlay, and affect subsequent computations as if accepted. The actual server rejects them. This is especially pertinent to §6.1's “adds to a cube's rotation every frame”: naive quaternion component addition rapidly ceases to be a unit quaternion. A preceding non-invalidating v2 may be queued while rejection for v1 is handled; the revision rule correctly preserves v2, but v2 itself may also be structurally doomed.

**Recommendation:** Reuse a renderer-neutral equivalent of the server's **entire transform value policy** at the runner's pre-overlay gate, including quaternion normalization tolerance and non-zero scale (and any other field-specific limits). Do not silently normalize the input unless that changed math semantics is expressly approved. Document that graph authors must produce unit quaternions. The light-color nonnegative check is *stricter* than the server's finite-only rule; choose this intentionally or harmonize it, but it is not a security issue.

**Proving test:** With a real server policy and runner, test rotation `[0,0,0,2]`, `[0,0,0,1]`, scale `[0,1,1]`, `[1e-7,1,1]` and `[1,1,1]` through both checks, and assert that invalid values never appear in queue or overlay. Exercise an `onTick` rotation graph that uses quaternion math rather than component addition. **INFERRED; server constraints SOURCE-CHECKED.**

#### M3 — Rollback restore is neither conflict-safe nor operationally authorized as specified

**References:** §8 rollback, §6.1 check 11; [`packages/server/src/world.js:407–452`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/server/src/world.js#L407-L452), [`packages/server/src/session.js:1145–1180`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/server/src/session.js#L1145-L1180).

**Scenario:** Export captures an imported 4d graph A. Roll back: 4c healing replaces A with `null` and persists the world when next saved. During the rollback, its owner legitimately installs a new 4c template behavior B **on the same object**, or deletes/recreates the object. After upgrading back to 4d, a restorer that blindly writes A by `objectId` through `send` overwrites B, or cannot find the original object. The rehearsal's *unrelated* edit does not catch this. Furthermore, the ordinary socket `send` route is owner-authorized; an offline script that traverses **every world's** exported behaviors does not automatically possess the authenticated owner session required to write private or absent-owner worlds. “Read from a copy” and “restore through send” are not yet an executable all-worlds procedure.

**Recommendation:** Define the restore as a **non-overwriting, idempotent reconciliation**: identify the exact world and immutable object identity; restore only when current behavior is the expected null/healed state, the object is still the intended object, and no newer behavior has been written; otherwise produce a conflict report and require owner approval. Capture enough before/after hashes or a per-object tombstone to discriminate deletion, manual disable and post-rollback replacement. Specify the offline maintenance authorization/apply mechanism (or an owner-authenticated per-world procedure), validated through the server's behavior policy without a broad unaudited bypass. Stop the server for export consistently, take and verify the database copy, preserve rollback snapshots, and demonstrate a complete restore including offline owners. Prefer roll-forward when these conditions cannot be met.

**Proving test:** Rehearse with two worlds owned by different accounts (owners offline), a 4d leaf healed to null, a different leaf changed during 4c, an object deleted/recreated, and an unrelated transform edit. Restore exactly the untouched lost graph; preserve all newer changes; produce explicit conflicts; rerun the restorer to prove idempotence. **INFERRED** from the stated rollback sequence and current owner-authorized server path.

### Should-fix

#### S1 — `listensForSelect` still tests a *stored op name*, not executable identity

**References:** G1 “Any declaration ... stored” and “`listensForSelect` unchanged”; G-L3, G3, §6 G1/G3; [`packages/server/src/send-policy.js:890–910`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/server/src/send-policy.js#L890-L910), [`packages/behaviors/src/behavior-spec.js:240–299`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/behaviors/src/behavior-spec.js#L240-L299).

**Scenario:** A validated, stored declaration `{op:'event/onSelect', extension:'EXT_probe'}` is unsupported by G3 and renamed to inert before load. Both copies of the unchanged `listensForSelect` nevertheless see the *stored* `op` and say this graph listens for clicks; the server accepts/forwards `activate`, consuming buckets and telling the host it has a select target even though no `OnSelect` runs. Alternatively, if G1's phrase “`event/onSelect` keeps its exact declaration” means such declarations are **refused**, it contradicts G-L3's “store any validator-accepted unsupported declaration.” Either interpretation needs a clear rule.

**Recommendation:** Prefer accepting the unsupported identity as inert and changing **both** `listensForSelect` copies to recognize only executable `(event/onSelect, KHR_node_selectability)` with a valid select node; keep selection target computation consistent with `graphReport`. If instead rejecting nonstandard `event/onSelect` declarations is intentional, state that explicit exception to G-L3 and test it. On stored-to-loaded graph equality, ensure selection reports what actually runs rather than just the stored spelling.

**Proving test:** Valid `EXT_probe/event/onSelect` alone: server and host say non-selectable, `activate` refused, engine inert. Exact Khronos identity still forwards and runs. Repeat with both identities declared and only the supported one instantiated. **INFERRED; predicate source checked.**

#### S2 — The new 1 MiB cap lacks direct add/Duplicate/Undo coverage

**References:** G2 and G7; §6 G2 test table (which covers `send` and rewrite/healing but not the `add` boundary); [`packages/server/src/session.js:1310–1355`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/server/src/session.js#L1310-L1355); [`apps/client/src/edit-undo.js:648–690`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/apps/client/src/edit-undo.js#L648-L690).

**Scenario:** The two gates are separate today: `authorizeSend` receives a `behaviorCount` callback, while `add` checks extras and the cap in a distinct branch. A developer can correctly implement the total for `send` while omitting it on `add` or counting the new descriptor twice. Duplicate and Undo re-add stored descriptors through `add` and can hit the budget even though undo history contains a previously accepted object; `edit-undo.js` drops a refused undo entry. This is a legitimate changed UX requiring an explicit test and message.

**Recommendation:** Expose one pure `behaviorBytesIn(som, excludeNode)` helper used by `send`, `add` and healing as applicable, counting **serialized UTF-8** sizes of non-null leaves only, with overflow-safe totals. Specify handling for a zero/new/rewritten/removed leaf; test add/duplicate/undo/redo/refusal end-to-end and explain cap-related Undo refusal in the UI. Verify healing operates on survivors and does not double-count dropped leaves.

**Proving test:** At 1 MiB minus N bytes, `send` replace, `add`, Duplicate and Undo re-add each attempt crossing and not crossing the threshold; assert identical outcome and no partial world mutation, including multi-byte graph strings. **INFERRED.**

#### S3 — `other` typed refs must not be presumed harmless just because no pointer is registered

**References:** G-L8, G6 `referencesOf` / `convertGraph`; G-L2 `ref/eq`, `event/send` / receive; [`build/index.js:11870–11950`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/gltf-interactivity-engine/build/index.js#L11870-L11950).

**Scenario:** G6 says `other` ref literals “are left as they are and listed (they only reach unsupported pointers).” That conclusion is not generally established for a typed `ref` carried through `variable/get`, event values, `ref/eq`, or dynamic ref sockets. `ref/eq` is allowlisted and can compare two unmapped external references to decide a *supported write*. Thus the reference is no longer confined to an unsupported pointer; leaving it unchanged can make the imported graph's decisions depend on file-local reference identities that no longer denote the same resources.

**Recommendation:** Classify each literal by its **consumer and reference namespace**, not only by its string prefix. Keep genuinely internal engine refs intact; explicitly mark opaque refs used only by an unsupported sink; refuse (or demand a human semantic mapping of) any external ref that reaches supported control/math/write behavior and cannot be translated. Make `other` a structured report with source and consumer rather than an implied safe pass-through. Iteratively enforce the depth limit before walking arbitrarily nested JSON for conversion.

**Proving test:** `ref/eq` of file-local material references deciding `pointer/set` to a mapped node, including equal/unequal refs, with an index permutation. Conversion must preserve its meaning or refuse, not claim the untouched literals only feed unsupported pointers. **INFERRED.**

#### S4 — The asynchronous interpolation test does not guarantee rejection containment

**References:** G3 interpolation and §6 G3 error test; [`build/index.js:8580–8618`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/gltf-interactivity-engine/build/index.js#L8580-L8618), `:8687–8695`; [`adapter.js:177–190`](https://github.com/joshmaurice/atrium/blob/2bb7013efa9d84d9c0fd3128f9103080ea864e74/packages/behaviors/src/adapter.js#L177-L190).

**Scenario:** The vendored `action` in pointer interpolation is declared `async` and the engine calls `interpolation.action()` without awaiting or catching the result. G3 promises no unhandled rejection, but the proposed proof “a throwing world” exercises a **total decorator setter** that already catches world throws. It therefore does not prove safety if the interpolation's own computation throws before invoking the setter (or a future engine upgrade rejects its action). A promise rejection bypasses the synchronous `tick()` `catch`.

**Recommendation:** Either prove all reachable interpolation actions cannot reject, or supervise returned promises at the dispatch seam without editing the vendored engine (e.g. wrappers with `.catch` that dispose/log, tested without double invocation). Do not rely solely on a throwing setter. Keep the pinned vendor hash, but state which adapter seam owns rejection observation.

**Proving test:** Force a rejected `action` before `setPathValue` and attach a process/window unhandled-rejection listener; assert the runner logs and disposes once with no unhandled rejection, including after disposal. **INFERRED; engine's call-site checked.**

### Nits

**N1 — §0 and §11 overstate what was independently “verified.”** `r1` and `r2` are good reproductions of old defects, but do not exercise new G3/G4/G5 code that does not yet exist. Clarify “reproduced underlying issue” versus “verified fix.” M2 is demonstrated by source event shapes, not either probe. **References:** §0.1 lines 76–115, §11; `r1`/`r2`. **Test:** in implementation review quote each new test's actual run, separately from probe baselines. **INFERRED.**

**N2 — Clarify the intended rotation demo.** §6.1 says a graph “adds to a cube's rotation”; specify a unit-quaternion-preserving operation and a fixed angular speed rather than naïvely adding quaternion components. **References:** §6.1 check 2, G4. **Test:** no `INVALID_VALUE` on the actual browser example over many ticks. **INFERRED.**

## Q3 and Q7

**Q3 — Confirmation on enabling a mutating `onStart`: YES, once, for imported graphs.** A persistent write can overwrite another visitor-visible edit whenever the owner reconnects or the host switches. The warning beside Enable is helpful but easy to miss amid a complex graph. Require a concise confirmation the first time an imported behavior with `startsOnLoad && writes` is enabled, highlighting especially any `targets` outside its own subtree. Do not ask on every subsequent reload or host election; do always retain the visible warning. Record this as an explicit owner decision so the implementer does not decide it implicitly. This confirmation is about *enablement*, not adding a popup on every `onStart` execution.

**Q7 — Keep 1 MiB as a provisional cap, subject to an explicit measured gate.** Do not lower it based only on the arithmetic `64 × 65,536`; the cap measures UTF-8 payload, whereas the real `som-dump` also includes document framing and other world state. Before MAIN/PROD approval, record wire bytes, serialize/heal time, browser parse/load time and memory for a 1 MiB-world case with multibyte strings and multiple visitors. Specify pass/fail thresholds for the target hardware in the acceptance card *before* choosing a lower limit; if check 10 breaches those thresholds, lower the cap and rerun the boundary, healing and join tests. Treat unrelated glTF geometry as a separate world-size pressure, not as proof the behavior cap alone is wrong.

---

**Bottom line:** The central Rev 1 design is substantially improved. The identity rewrite, monotonic delay IDs, injected-observable clock, richer importer guards and explicit storage budget are sound directions. I would clear this pre-brief after M1–M3 are specified and tested at the named seams; the should-fixes can be addressed in the same targeted revision. All judgments here remain **source-only**, not claims to have run the 4d code or probes.
