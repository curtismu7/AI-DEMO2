# Privilege policies in depth

What a Privilege tool policy actually does when there is more than one of it.
Every behavior here was measured live on 2026-10-10 against the Agent
Privilege gateway (`mcpgw.ai-demo.ping-devops.com`, mesh `ai-demo-cmuir`),
using the `opensearch22` Agentic App — a backend of 9 MCP tools — as the test
bench, with the client's tool count and the console's policy list as the
instruments. The full step-by-step evidence lives in
`~/Documents/Privilege Sensor Docs/POLICIES-IN-DEPTH-TEST-PLAN.md`; this guide
is the distillation.

## The one-sentence model

> **The effective grant is the union of every non-expired policy that binds
> the identity, deduplicated at discovery.** Creating a policy adds to that
> union; nothing about the console suggests it.

Everything below follows from that sentence.

## The four behaviors, measured

The four things an operator does to a policy, and what each actually does to
the grant. Steps B–E of the test plan, one row each:

| Console action | Effect on the effective grant | Measured |
|---|---|---|
| **Create a new policy** | **Adds** its tools to the union. Two policies sharing a tool deliver it once — the union is a set, deduplicated at delivery | C: policy1 {A,B} + policy2 {B,C} → client saw **3** tools, no duplicate |
| **Let a policy expire** | **Silently subtracts** that policy's whole contribution. The client sees the smaller catalog with no hint why | D: expiring policy1 → 3 → **2**, no client-visible reason |
| **Delete a policy** | **Subtracts identically** to expiry — the same state, produced by a different action | E: deleting policy1 → **2**, unchanged from D |
| **Edit a policy's tool list down** | **Does nothing** to the identity's grant while any broader policy stands — the edited policy is one member of a union, not the definition of it | The 2026-09 incident: three "fix the policy" rounds, each *adding* a policy, before the cap header revealed the mechanism |

One sentence for the demo: **create → adds · expire → silently subtracts ·
delete → subtracts identically · edit down → does nothing while any broader
policy stands.**

### The union, refined

The 2026-09 capture (in [Lessons learned](LESSONS-LEARNED.md)) showed
duplicated tool names in the `[mcpfilter] cap header` log line — 12 entries,
`list_populations` ×3. The 2026-10-10 run adds the other half: the
**client-visible** `tools/list` is the *deduplicated* union. Both are real;
they live on different sides of the gateway. The cap header is what the
gateway announces upstream (per-policy contributions, with duplicates); the
client list is the set the identity actually gets.

Provenance note, in the spirit of this repo: the 2026-10-10 union count (3)
is the operator's client-side observation; the tool names were not captured,
so the {A,B}+{B,C} arithmetic is inferred from "two policies, one shared
tool". The *mechanism* — additive policies, deduplicated delivery — is the
claim; 3 is one observed instance of it.

## Discovery-gating: why the client never sees "denied"

A policy hides a tool at `tools/list`, not at call time. The gateway removes
tools outside the grant **before responding** — `tools/list` returns only the
permitted set, and the client cannot tell the others ever existed. The
`_meta.deniedTools` field a client could read exists only on the WS transport
(for UI graying); on the HTTP/MCP path denied tools are dropped entirely
(`GatewayServer.ts`: "dropped entirely — same as before this fix").

Measured consequence: with a 2-tool policy, the demo client's Tools rail read
"2 catalog · 2 permitted · **0 filtered**" — structurally true (nothing was
delivered-then-denied) and operationally misleading (the filter is exactly why
the catalog is small). Fixed in PR #1091: the rail now reads *"N tools in your
grant — tools outside the policy are undiscoverable"* on gateway doors.

This is the closing line of the discovery demo, and it is a policy statement:
**the catalog an agent sees IS its privilege level.**

## Denial modes the client cannot tell apart

Four failures render identically to the client as a bare `403 Forbidden` (or,
for discovery-gated tools, as absence from the catalog). Only the gateway log
distinguishes them:

| Client sees | Log line | Truth | Fix |
|---|---|---|---|
| 403 on everything | `policy denied … : user not found in system` | The identity never synced into Privilege | Fix group membership / user sync — **not** the app's policy |
| 403 on everything | `policy denied … : Access Denied for` | Identity is synced; no policy on **this app** covers them | Author or fix the policy on this app |
| Tool missing from `tools/list` | `Removing unauthorized tool from MCP response` | Tool exists; policy hides it | Grant it, or accept the gate |
| Smaller catalog, no error | *(nothing — expiry is silent)* | A policy's window lapsed | Check the time window (step D) |

And the null case: a **freshly registered app denies everything** until a
policy exists — not "default permit," not inherited. If a door answered
minutes ago and now 403s on `initialize` itself with no config change, check
whether the app was recreated (delete + re-add resets to deny-all).

## Groups: documented, not reproduced this run

The union mechanism is proven for **user-bound policies** (steps C, D, E). A
group-attached policy was **not** reproduced in the same session: attaching a
policy via a group the demo user belongs to left the client count unchanged
(step F, 2026-10-10). Do not present "groups feed the union" as measured.
When retrying, in order:

1. Verify the policy's group is the one the **resolved** identity belongs to —
   identity resolution at sign-in decides whose policies apply, and the
   "user not found in system" failure is the same binding gone wrong
2. Verify the group picker actually named the intended group
3. **Sign in fresh** — steps B–E took effect mid-session, but those policies
   were already bound to the user directly; a newly attached group may need a
   new session to resolve

## Policies are per-app

A policy on one Agentic App has zero effect on a sibling app running identical
code — `opensearch` and `opensearch22` each need their own. The app is the
policy's scope; there is no cross-app inheritance.

## When a "policy problem" isn't one

The 2026-10-10 run opened with a `500 dial tcp 172.20.238.8:80: i/o timeout`
that looked like a policy failure (the session had just been granted 2 tools).
It was not: authentication *succeeded*, and the failure was the gateway
dialing the backend — a Kubernetes Service whose port and selector had drifted
from the Helm chart (port 9900 where the registered backend expected 80).
Patched the Service port; the registered backend worked unchanged. The trap to
avoid: "fixing" it in the console by editing the app's Backend URL to `:9900`
— backend edits rewrite the client-facing entry path (the 2026-09-08
incident). Fix the Service, not the app registration.

**Diagnostic order when tools vanish or 403:** (1) does the gateway log say
`policy denied` — and with which reason, (2) is the policy's time window live,
(3) does *another* policy on the app still grant broader access (the union),
(4) is the backend even reachable from the gateway pod.

## Test matrix

All steps measured 2026-10-10 against `opensearch22`; full evidence and
commands in the test-plan document (repo-external, `~/Documents/Privilege
Sensor Docs/POLICIES-IN-DEPTH-TEST-PLAN.md`):

| Step | Console action | Client result | Status |
|---|---|---|---|
| B | Policy edited down to 2 tools | 2 catalog · 2 permitted · 0 "filtered" (structural) | ✅ |
| C | Second overlapping policy added | 3 tools — the union, deduplicated | ✅ |
| D | Policy #1's window expired | 2 tools — silently, no reason shown | ✅ |
| E | Policy #1 deleted | 2 tools — identical to D | ✅ |
| F | Group-attached policy added | 2 tools — **no change**; see the Groups section | ✅ (no-change finding) |
