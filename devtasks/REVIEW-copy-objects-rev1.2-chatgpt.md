<!-- Outside review (ChatGPT) of PREBRIEF-copy-objects.md DRAFT Rev 1.2 at 2746d663, source-only (clone failed on DNS).
     Pasted by the operator on 2026-11-06 evening (the summary ChatGPT showed; its full file was offered as a download). -->

# Atrium `copy-objects` — Outside Design Review

CHANGES REQUESTED

Reviewed commit: `2746d6634db08501273f3bf68faf77aeda021e2f`\
Document: [PREBRIEF-copy-objects.md, DRAFT Rev 1.2](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/devtasks/PREBRIEF-copy-objects.md?utm_source=chatgpt.com)\
Review type: Read-only, source-only.

Repository access: I attempted the requested clone first. It failed with:

```
fatal: unable to access 'https://github.com/joshmaurice/atrium.git/': Could not resolve host: github.com
```

I was nevertheless able to retrieve the pinned pre-brief, source files, and previous reviews through the GitHub integration. I could not install dependencies, run the project's tests, or execute the requested WebSocket probe. No deployed site was touched.

## Overall assessment

The separation into `add-check`, `richer-add`, and `copy-objects` remains sound. The credit design, server-relative URL handling, snapshot approach, and addition of K0's production WebSocket payload cap are generally well specified.

The principal remaining problem is CP-L5(c), the decision to retain foreign behavior references unless they match destination objects at paste time. That check cannot establish the long-term safety the design claims, especially when another browser tab has an independent Undo history.

There is also a contradiction between malformed-credit recovery and Copy's existing eligibility rules, plus a missing API needed to implement the Undo-aware ID check.

These are design findings, not defects in a copy implementation that has not yet been written.

## Must-fix findings

### M1 — Foreign behavior references can become valid after the paste

Severity: Must-fix\
Status: CONFIRMED IN THE SOURCE for the relevant mechanisms; INFERRED for the proposed paste sequence.

References: [Pre-brief §3 CP-L5, lines 342–383](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/devtasks/PREBRIEF-copy-objects.md?utm_source=chatgpt.com#L342-L383), [§4 K7, lines 580–598](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/devtasks/PREBRIEF-copy-objects.md?utm_source=chatgpt.com#L580-L598), [edit-undo.js:696–708](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/apps/client/src/edit-undo.js?utm_source=chatgpt.com#L696-L708), [runner.js:269–283](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/packages/behaviors/src/runner.js?utm_source=chatgpt.com#L269-L283).

Failure scenario:

1. World B contains a door with object ID `D`. An attacker visits B while it is public and learns `D` from its SOM.
2. The attacker creates an object in world A with a template behavior whose target and grant refer to `D`.
3. B's owner, using browser tab 2, deletes the door. Tab 2's Undo history can restore it, but tab 1 has no knowledge of that history.
4. In tab 1, the owner copies the attacker's object from A and pastes it into B. The door is absent from B's SOM, and `D` is absent from tab 1's Undo/Redo history. K7 therefore preserves `D`.
5. Tab 2 undoes the deletion. `prepareRestore` preserves the original object ID, so the door returns as `D`.
6. The owner enables the pasted behavior. A template does not require K7's custom-graph confirmation. Its originally foreign reference now resolves to the door, and its stored grant authorizes writing to it.

The same timing problem exists when another tab restores a target between `preparePaste`'s check and the server accepting the add.

This does not depend on a random UUID collision. It uses an ID the source-world author deliberately learned from the destination.

The pre-brief acknowledges a restore of an object deleted after the paste, but the cross-tab case shows that even objects deleted before the paste can evade `destIds`. The source confirms that Undo/Redo restores retain IDs and that the behavior runner resolves targets through those IDs.

Recommendation: Return to CP-L5(a1): for a foreign-world paste, replace every non-self reference with a fresh unused ID, consistently across all reference tables. Preserve indices, and validate the result with `behaviorCheck`.

If retaining the original references is important, store them separately as inert, bounded descriptive metadata, rather than as potentially executable targets or grants.

Disabled-on-arrival is useful, but it does not prevent the problem once the owner enables the behavior.

Required test: An attacker-controlled reference to a destination object is pasted while that object is deleted in a second tab; the second tab restores it; the owner enables the pasted template. The restored object must remain unreachable through the pasted behavior.

### M2 — K2's malformed-credit recovery contradicts K5's Copy eligibility check

Severity: Must-fix\
Status: CONFIRMED IN THE SOURCE and the pre-brief; proposed behavior INFERRED.

References: [Pre-brief §4 K2–K5, lines 503–553](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/devtasks/PREBRIEF-copy-objects.md?utm_source=chatgpt.com#L503-L553), [edit-duplicate.js:101–127](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/apps/client/src/edit-duplicate.js?utm_source=chatgpt.com#L101-L127), [edit-duplicate.js:320–332](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/apps/client/src/edit-duplicate.js?utm_source=chatgpt.com#L320-L332).

K2 says an existing malformed `origin` or `copiedFrom` is replaced at Paste, with a note explaining the replacement. Section 5 explicitly tests that recovery.

But K5 requires `copyObject` to run `duplicateRuleProblem` before building the clipboard snapshot. K3 adds credit validation to `atriumProblem`, which `duplicateRuleProblem` calls.

Consequently, an object with malformed existing credit fails at Copy, before `preparePaste` gets an opportunity to repair it.

That creates two incompatible promised outcomes:

- K3/K5: refuse copying the malformed-credit object.
- K2/§5: allow the copy and repair the credit at Paste.

Recommendation: Choose one rule explicitly. My preference is to allow the cross-world Copy path to sanitize only the malformed credit fields, without relaxing other Duplicate eligibility checks, while preserving a clear warning. Alternatively, retain the refusal and remove the unreachable repair promise and tests. Either choice is coherent; the present contract is not.

### M3 — K7 requires Undo/Redo IDs that the current Undo API cannot supply

Severity: Must-fix for the chosen CP-L5(c) design\
Status: CONFIRMED IN THE SOURCE.

References: [Pre-brief K7 and §6](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/devtasks/PREBRIEF-copy-objects.md?utm_source=chatgpt.com#L580-L598), [edit-undo.js:747–774](https://github.com/joshmaurice/atrium/blob/2746d6634db08501273f3bf68faf77aeda021e2f/apps/client/src/edit-undo.js?utm_source=chatgpt.com#L747-L774).

K7 needs IDs of objects that Undo can restore. But `createEditUndo` keeps its stacks private, exposing only counts, bytes and labels—not restorable IDs or descriptors.

Importantly, Redo can restore IDs too: Redo of an undone add restores its original object ID.

The proposed file list also excludes `apps/client/src/edit-undo.js`, while explicitly prohibiting changes to unlisted files.

Recommendation: If CP-L5(c) remains, add an accessor exposing restorable object IDs from both stacks, add the file to §6, and test both restoration directions. This still does not fix M1's cross-tab problem. Replacing all foreign references would eliminate the need for this API.

## Should-fix findings

| Finding                                                                 | Evidence                | Recommendation                                                                                                                                                |
| ----------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 — K0 misses a second WebSocketServer                                 | CONFIRMED IN THE SOURCE | `world-registry.js:67` creates an uncapped refusal socket. It closes immediately, so its exposure is narrower, but applying the same limit is prudent.        |
| S2 — Retained references may make the entire behavior unrunnable        | CONFIRMED IN THE SOURCE | `runner.js:361–365` disables loading when any external `nodeMap` ID is missing. The Behavior panel should explicitly explain that the target must be rebound. |
| S3 — Third-party model confirmation is ambiguous for same-server copies | INFERRED                | K8 should ask before placing a model hosted on a third-party server even when source and destination worlds share an Atrium server.                           |
| S4 — Credit timestamp semantics                                         | INFERRED                | K2 describes the first Copy, but K6 supplies the date at Paste. Capture the Copy date if `at` is supposed to identify when copying occurred.                  |

## Nits and test additions

The Public/Private UI should clarify that visitors can copy content when the world is public. K5 should also define whether Copy itself checks the fully serialized descriptor size, rather than allowing a Copy that is already too large to Paste. Finally, K6's `preparePaste` signature should explicitly include the `worldId` and `destIds` inputs required by K7.

The most important addition to §5 is the two-tab adversarial restoration test described in M1. The existing tests exercise a match visible at paste time, but not a match that becomes valid afterward. If the behavior policy changes to neutralize all foreign IDs, proof p1b and its associated tests must change accordingly.

## What looks sound

K0's main fix is correctly targeted: `createWorldHost` currently lacks the inbound 1 MiB cap that `createSessionServer` already has. The existing client's 1,000,000-byte Duplicate limit leaves approximately 48 KiB of headroom.

K1's optional owner name accommodates DB-less test worlds, while client-side validation protects against malformed `hello.world` data. K2–K3's bounded, explicitly unverified attribution is appropriate. The copy-time snapshot, separate Paste answer handling, and source-relative model/pad URL resolution are also solid design choices.

Recommendation for the next revision: Resolve M1 first, preferably by neutralizing all foreign executable references while preserving their descriptive meaning separately. That also simplifies M3. Fix M2's contradictory requirements, then close the narrower issues before implementing.

## Complete review file

I prepared the full review as Markdown, including source locations, classifications, failure scenarios, suggested fixes, and test recommendations.

REVIEW-copy-objects-rev1.2-chatgpt.md

Complete 1,858-word review · ready to pass to the implementation team

Download review

The review is CHANGES REQUESTED, principally because of the behavior-reference safety issue—not because the overall copy-objects design needs to be redone.