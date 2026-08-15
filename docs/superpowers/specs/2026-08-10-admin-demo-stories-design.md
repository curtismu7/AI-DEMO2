# PingOne Admin agent — demo stories

**Date:** 2026-08-10
**Status:** Design, approved in brainstorming. Not yet planned or implemented.
**Scope:** Stories A, B and C, plus a decision-reason surface shown *both* inline in the agent reply and on the ProofStrip.

## Problem

The PingOne Admin agent has Demo steps, and they work. `routes/useCases.js:32` serves
`ADMIN_DEMO_STEPS` for `vertical=pingone-admin`, and the dropdown renders them.

The problem is what they say. All four are read-only list calls:

| Step | Prompt |
|---|---|
| ADMIN1 | List all PingOne applications in this environment |
| ADMIN2 | List the users in my PingOne environment |
| ADMIN3 | List the populations in my PingOne environment |
| ADMIN4 | Get the details of my PingOne environment |

Four successful reads in a row. Nothing is refused, so nothing is proven. The file's own
header says why: the admin agent has "no consent/HITL gate or tokenChain evidence
narrative to attach." That was true when it was written. It is no longer true — the
group gate landed in `55fc82f9f`, and the dashboard now carries a live membership toggle.

These stories exist to spend that capability.

> **Correction to the brainstorming notes.** An earlier pass in that session claimed
> `ADMIN_DEMO_STEPS` was "referenced by exactly one thing — a test" and that no admin
> story could run until the steps were served. That was wrong; it came from a truncated
> grep. The steps are served. There is **no prerequisite task** — the work is
> strengthening four weak steps, not building a missing pipe.

## What the gate actually is

Story A rests on the group gate, so its mechanics have to be stated precisely.

`services/pingOneAdminAccessService.js#checkAccess` resolves the required group for the
`pingone-admin` vertical, calls `listUserGroupNamesForVertical` — a **live PingOne
directory lookup on every request** — and returns `403 pingone_admin_group_required`
when the user is not a member. `routes/adminAgentRoutes.js` enforces it before exposing
or running any admin tool.

Two consequences, and the difference between them is the whole point of Story A:

- **True, and worth showing:** membership is read at decision time from the directory.
  Adding or removing the group changes the next call's outcome with no new token and no
  re-login. Revocation does not wait for token expiry.
- **Not true today:** this is *not* a PingOne Authorize decision. It is a BFF membership
  check. The brainstorming punchline credited P1AZ; the demo does not back that claim.

This matters beyond wording. `p1az-mock` is authored policy, so a DENY on screen is not
by itself proof a rule ran. A story that says "Authorize decided this" while the BFF
decided it is exactly the kind of claim an SE gets caught on.

**Decision for this spec:** Story A claims what the code does — a live directory read at
decision time, enforced before the tool runs. Routing the gate through PingOne Authorize
is a *separate*, larger piece of work; it is listed under Deferred, not smuggled in here.

## Story A — "Scopes are not entitlements" (flagship)

| Step | Chip / action | Must be visible on screen |
|---|---|---|
| A1 | "Show me my agent's token and scopes" | Token display: every scope the tool requires is **present** |
| A2 | "Run the group-gated admin tool" | **DENY**, with the reason naming the missing group |
| A3 | Admin clicks *Add to `pingone-admin`* | Confirmation of a live PingOne directory write |
| A4 | "Run it again" | **PERMIT** — same token, no re-login |
| A5 | Admin clicks *Remove*, then "Run it again" | **DENY** again, immediately |

**What it lands:** a caller holding every required scope is still refused, because
entitlement lives in the directory and is read at decision time — and removing it takes
effect on the next call, not at token expiry.

**Why A2 must precede A3.** The demo has to open on a refusal. If the operator starts in
the group, every step succeeds and the story evaporates — the same failure as ADMIN1–4.
The step definition must therefore assert the *starting* state, not assume it.

**Already built:** the gate, the toggle, the 403, the live lookup.
**To build:** the step wiring, and the decision-reason surface below.

## Story B — "Least privilege for a machine identity"

| Step | Must be visible |
|---|---|
| B1 | Token chain: subject token → exchanged actor token, with audience and scope visibly narrowed |
| B2 | Flip exchange mode — the chain changes shape on screen |
| B3 | Raise a threshold — an action that just passed now demands step-up |
| B4 | Open the decision evidence behind it |

**What it lands:** the agent never wields the user's token. It gets a narrowed,
audience-bound one, and the leash tightens live.

**Already built:** all four surfaces exist.
**To build:** sequencing, plus a step-up beat that fires reliably. B3's assertion must
expect the status the code actually returns, which depends on a flag: with
`ff_rfc9470_challenge` ON — its default — a step-up block is an RFC 9470 **401**
`step_up_required`; the legacy **428** appears only with the flag off. Asserting 428
unconditionally will fail on a default stack.

## Story C — "Who did what, and could they?"

| Step | Must be visible |
|---|---|
| C1 | Customer lookup returns the real PingOne record |
| C2 | Event stream shows the action that occurred |
| C3 | Token chain reconstructs which principal acted, under which grant |
| C4 | Admin revokes the entitlement; the next attempt fails |

**What it lands:** every agent action is attributable to a human principal, and it can be
proven after the fact.

**Weakest of the three, and it should be built last.** C1–C3 are a narrated read of
things that already happened. Without a scripted fault worth investigating, the operator
walks an audit trail to discover that nothing went wrong. C4 is the only beat with
tension, and it duplicates A5. Build C only if a specific fault scenario is chosen first;
otherwise cut it and let A carry revocation.

## Decision-reason surface

Approved: the reason appears **both** inline in the agent reply and on the ProofStrip.

- **Inline** — the presenter is looking at the transcript when the DENY lands. A reason
  that only exists in a side panel is a reason the room does not read.
- **ProofStrip** — the durable artifact, consistent with every other vertical, and what
  someone checks after the fact.

One source. Both surfaces render the same `{ decision, reason, requiredGroup }` the gate
already returns — they must not compose their own wording, or they will drift and the
demo will contradict itself on screen.

Known trap: the ProofStrip has previously shown "Incomplete" on a successful path when
evidence arrived only via cookie. Whatever emits the reason must emit it on the DENY path
too, not only on PERMIT.

## Testing

Each story gets step-verification entries under
`demo_api_server/data/step-verification/pingone-admin/`, matching the pattern the banking
use cases already use.

The assertion is on **evidence**, not dispatch. A chip that "ran" while showing nothing is
the failure this guards against — it is how ADMIN1–4 look healthy while proving nothing.
Concretely:

- A2 asserts a DENY *and* a reason naming the group. A bare 403 is not enough.
- A4 asserts a PERMIT reached the tool, and that no new token was minted between A2 and A4
  — otherwise the story's central claim is untested.
- B1 asserts the exchanged token's audience and scope are narrower than the subject's.
- Every step that claims a decision asserts the decision, not the absence of an error.

`revert-to-RED` each one: break the gate and confirm the test fails. A step-verification
entry that passes against a broken gate is worse than none, because it certifies the
demo.

## Deferred

- **Routing the group gate through PingOne Authorize.** Would let Story A truthfully
  credit P1AZ. Separate work; do not fold into these stories.
- **A day-2 provisioning story** (create user, assign population). Needs PingOne MCP write
  tools, and `createUser` ignores `passwordValue` — a `manageUserPassword set` must
  follow. Sharp edges; out of scope here.
- **Story C's fault scenario.** Unspecified by design. C stays unbuilt until it exists.

## Open question

Story A's A2 needs a specific tool that is group-gated and whose refusal reads clearly to
a room. The gate covers the admin tool set as a whole, so any of them technically works —
but "List applications" refusing is a weaker image than a write or a
privileged read being refused. Which tool A2 uses should be settled before planning.
