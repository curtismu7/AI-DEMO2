# Autonomous Agents vs Worker Agents — Identity Plan

Status: proposal, 2026-08-26. Nothing implemented yet.

## The distinction that matters

Not "how smart is it" — **is a human present at the moment the token is minted?**

| | **Worker agent** | **Autonomous agent** |
|---|---|---|
| Trigger | A user turn in a live BFF session | A schedule, an event, or another agent |
| Who is the subject | The human (`sub` = user) | The agent (`sub` = agent's own identity) |
| Delegation proof | RFC 8693 exchange, `act.sub` = agent client | None available — nobody to delegate |
| Grant | `urn:ietf:params:oauth:grant-type:token-exchange` on a live user token | `client_credentials`, then exchange for a resource audience |
| Authorization input | User's groups/entitlements + agent restrictions | Agent's own entitlements + a standing mandate |
| Approval for risky action | HITL consent in-session (user is right there) | **CIBA** — push to the absent human's device |
| Blast radius when wrong | One session, user's own scope | Every scheduled run until someone revokes |
| Revocation | Session ends | Must be explicit — kill switch, lifecycle event |

Everything else (MCP tools, gateway, scope topology, trace) is identical. This is the whole point: one plane, two identity shapes.

## Where the demo actually is today

**Every agent in the demo is a worker agent.** Verified 2026-08-26:

- Every run enters through a chat turn (`routes/agentRun.js`, `demoAgentRoutes.js`) with a BFF session in hand.
- `services/agentCCTokenService.js` does mint a pure `client_credentials` token — but as Step 1 of the two-exchange chain, *inside* a user request. It is a machine hop, not an autonomous actor.
- The only cron in the BFF is `lighthouseScheduler.js` (Lighthouse audits). No scheduled agent run exists.
- CIBA (`cibaService.js` real / `cibaSimulatedService.js`) is built and reachable, but fires during an in-session HITL pause — i.e. we ask an absent-user question while the user is present.
- The A2A specialists (11 apps) are described in [pingone-ai-agents-migration-plan.md](../docs/pingone-ai-agents-migration-plan.md) as "autonomous actors". They are not — they are sub-hops of a user-initiated chain. The migration to PingOne `AI_AGENT` identity type is still right, but the word "autonomous" there is wrong today.

So the gap is exactly one thing: **there is no way for an agent run to start without a human turn.** Add that trigger and every other primitive we need is already built.

## Plan

Each phase is independently demo-able and stops somewhere useful. Phase 1 alone gives the story.

### Phase 1 — Make the class explicit (no new runtime behavior)

Declare which agents are which, and surface it. Today "agent" is one undifferentiated word in the UI and in PingOne.

- Add `agentClass: "worker" | "autonomous"` to the agent registrations in `scope-topology.json`. It is a label, not a switch — nothing branches on it yet.
- Mirror it as the PingOne AI Agent record's description/attribute during the migration already planned in [pingone-ai-agents-migration-plan.md](../docs/pingone-ai-agents-migration-plan.md), so the Directory > AI Agents list is filterable by class.
- Show it in the token chain / trace surface: a worker chain shows `sub=user, act=agent`; an autonomous chain will show `sub=agent, no act`. The trace already renders both fields — this is a label, not new plumbing.

Success: `npm run topology:verify` passes with the new field; the trace names the class for an existing run.

### Phase 2 — One real autonomous trigger

The minimum thing that makes an agent autonomous: it runs when no one is watching.

- One scheduled job using `node-cron` (already a dependency, already the pattern in `lighthouseScheduler.js`) that calls the existing agent-run entry point with **no session**.
- Token: `agentCCTokenService.getAgentCCToken()` as-is → existing exchange to the resource audience. No new token code. The chain is the same minus the user leg.
- Persist the run through the existing `agentRunStore` / `agentTransactionTracker` so it lands in the trace and the activity log like any other run.
- Behind `ff_autonomous_agents`, default OFF.

Pick **one** narrow job for the demo — suggestion: a nightly "balance sweep / fraud watch" in Super Banking that reads and reports. Read-only first: no money moves without Phase 3.

Success: with the flag on and no browser open, a run appears in the trace with `sub` = the agent and no `act` claim; with the flag off, nothing runs.

### Phase 3 — The absent human (CIBA, for real)

This is where the class difference earns its keep. The autonomous run hits something it is not allowed to do alone.

- The scheduled run attempts a write above a threshold → the existing authorize/HITL path returns the deliberate `INDETERMINATE` pause.
- Instead of an in-session consent modal, the pause routes to CIBA — push to the owner's device, run parked until they approve or it expires.
- Reuse `cibaService` / `cibaSimulatedService` unchanged. Note `docs/ciba-real-provisioning-todo.md`: on env `01d89b06` the real CIBA client is still unprovisioned, so this demos simulated until that console work is done.

Success: the run parks; approving on the phone resumes it; expiry cancels it and shows as such in the trace.

### Phase 4 — Standing mandate and revocation

An autonomous agent has no session to end, so containment has to be explicit.

- Mandate: what this agent may do unattended, expressed as the scopes it can get and a ceiling (amount, count, window). The `agentRestrictions` tier (`read` / `write` / `none`) in `agentRestrictionsService.js` is already the right shape — extend it with the ceiling rather than inventing a second mechanism.
- Revocation: the existing kill switch + `agentLifecycleEvents` (joiner/mover/leaver, SailPoint forwarder) already covers "disable this agent". For an autonomous agent it must also cancel the schedule, not just deny the next tool call.
- Design reference already in repo: `docs/superpowers/specs/2026-06-27-agent-access-revocation-design.md`.

Success: killing an autonomous agent stops the next scheduled run, and the lifecycle event shows in the control-plane feed.

## What this plan deliberately does not do

- No new token type, no new grant, no AIP / transaction-token adoption. Those drafts are surveyed in [IETF-AGENT-AUTH-DRAFTS-2026.md](../docs/IETF-AGENT-AUTH-DRAFTS-2026.md); the demo's existing RFC 8693 + CIBA story covers autonomous-vs-worker without them.
- No agent-to-agent autonomy (an autonomous agent spawning autonomous agents). One level.
- No new UI surface. Class label goes on existing trace/roster surfaces.
- No change to any worker-agent path. Phase 2 adds a second entry point; it does not touch the chat one.

## Open questions

1. Which vertical carries the autonomous demo? Super Banking is the default; a fraud/balance sweep tells the story best.
2. Does the autonomous agent get its **own PingOne AI Agent identity**, or reuse the root "Super Banking AI Agent" client with a different grant path? Own identity is cleaner for the inventory story and costs one more registration.
3. Real CIBA or simulated for the launch demo — gated on the console provisioning in `ciba-real-provisioning-todo.md`.
