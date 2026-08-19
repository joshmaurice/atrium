# Standard clause: adversarial testing on authority boundaries

Include this section in every implementation task brief from now on. It exists
to close a specific, observed blind spot: happy-path tests that only exercise
the case where client and server already agree, leaving the actual security
invariant — "the server decides, the client is not trusted" — untested. Code
can pass a full green suite while silently violating that invariant, because
the invariant only bites when inputs *disagree*.

---

## Required: test the disagreement case, not just the happy path

For any code in this task that enforces server authority — anywhere the server
assigns, validates, rejects, or overrides a value the client also supplies —
the tests must include at least one case where **the client sends a value that
conflicts with what the server expects**, and assert that the server's value
wins.

A happy-path test (client sends the value the server would have assigned
anyway) does **not** satisfy this. That test passes whether or not the
authority check works, because the two values are identical. The test that
proves the check works is the one where they differ.

### Concretely, for each authority boundary in the task, write a test that:

1. Puts the server into its authoritative state (it has assigned/decided the
   value).
2. Has the client send a **different** value for the same thing.
3. Asserts the server either **rejects** the message (with the specific error
   code) or **overrides** the client value with its own — whichever the design
   specifies.
4. Asserts the server's authoritative state is **unchanged** by the client's
   attempt (the client could not mutate it).

### The mental check before you consider the task done

For every line where the server reads a client-supplied value, ask: *"What
happens if the client lied here?"* If the answer isn't covered by a test,
that test is missing. "It can't happen because the client is well-behaved" is
not an answer — the entire point of server authority is that the server does
not depend on the client being well-behaved.

### Examples of authority boundaries that need a disagreement test

- Server assigns an ID/name and the client echoes it back → test the client
  sending a *different* ID/name.
- Server derives identity from the connection/session → test a message
  *claiming* a different identity than the connection it arrived on.
- Server owns a piece of state and the client requests a change → test a
  request the client is *not* authorized to make.
- Server validates against a schema or an assigned value → test input that
  violates it, and assert rejection, not silent acceptance or correction.

If the task has no authority boundary at all (pure client-side work, a
mechanical refactor with no trust decision), state that explicitly in your
report rather than omitting the section silently — so the absence is a
decision, not an oversight.
