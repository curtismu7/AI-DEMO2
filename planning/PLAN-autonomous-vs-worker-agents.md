# Autonomous Agents vs Worker Agents — Identity Plan

Status: proposal, 2026-08-26. Nothing implemented yet.

**Decided 2026-08-26** (was open): two jobs, read-only first then the write job with Phase 3 · each autonomous agent gets its **own** PingOne `AI_AGENT` registration · CIBA stays **simulated** for launch.

Mockups of the console surfaces: <https://claude.ai/code/artifact/d1cc4e56-6959-4b18-aca1-e794f50bca2f>

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
- Give each autonomous agent its **own** PingOne `AI_AGENT` registration rather than reusing the root agent client, and carry `agentClass` on that record. This is what makes the class visible at the PingOne layer — per-agent revocation, per-agent audit, and a Directory > AI Agents list that can be filtered to "everything that runs unattended". Folds into the migration already planned in [pingone-ai-agents-migration-plan.md](../docs/pingone-ai-agents-migration-plan.md); costs one registration per job.
- Show it in the token chain / trace surface: a worker chain shows `sub=user, act=agent`; an autonomous chain will show `sub=agent, no act`. The trace already renders both fields — this is a label, not new plumbing.

Success: `npm run topology:verify` passes with the new field; the trace names the class for an existing run.

### Phase 2 — One real autonomous trigger

The minimum thing that makes an agent autonomous: it runs when no one is watching.

- One scheduled job using `node-cron` (already a dependency, already the pattern in `lighthouseScheduler.js`) that calls the existing agent-run entry point with **no session**.
- Token: `agentCCTokenService.getAgentCCToken()` as-is → existing exchange to the resource audience. No new token code. The chain is the same minus the user leg.
- Persist the run through the existing `agentRunStore` / `agentTransactionTracker` so it lands in the trace and the activity log like any other run.
- Behind `ff_autonomous_agents`, default OFF.

Two jobs, sequenced so risk arrives after the mechanism is proven:

1. **Nightly Fraud Watch** (this phase) — scans overnight transactions, flags anomalies, **writes nothing**. It proves the unattended trigger and the `sub=agent`/no-`act` chain with nothing at stake.
2. **Balance Sweep** (arrives with Phase 3) — moves money on a schedule, so it hits the mandate ceiling and gives Phase 3's CIBA pause something real to pause.

Both in Super Banking. The read job alone never exceeds a ceiling, which is exactly why it cannot carry the Phase 3 story on its own.

Success: with the flag on and no browser open, a run appears in the trace with `sub` = the agent and no `act` claim; with the flag off, nothing runs.

### Phase 3 — The absent human (CIBA, for real)

This is where the class difference earns its keep. The autonomous run hits something it is not allowed to do alone.

- The scheduled run attempts a write above its standing mandate → the run **pauses**. A pause is `PERMIT` carrying an unfulfilled obligation, not a third decision value (`demo_authz_server/index.js`, INDETERMINATE rework 2026-08-19, pinned by `decision.contract.test.js`).
- **`INDETERMINATE` is not a pause.** It is what policy evaluation returns when the inputs or rules never reach an explicit PERMIT or DENY — an unresolvable request. The PEP fails closed and treats it as DENY. An autonomous agent with no declared mandate is exactly that case: it is refused, and **no CIBA is raised**, because asking a human to approve a request no policy could reason about just moves an unbounded agent past a rubber stamp.
- Instead of an in-session consent modal, the pause routes to CIBA — push to the owner's device, run parked until they approve or it expires.
- Reuse `cibaService` / `cibaSimulatedService` unchanged.
- **Launch on simulated CIBA.** The approval is fake; the parked run, the expiry, and the trace are all real, and the swap to real CIBA is env-var only (`PINGONE_CIBA_CLIENT_ID` / `_SECRET`) with no code change. Real CIBA needs the PingOne Admin + DaVinci console work in `docs/ciba-real-provisioning-todo.md` on env `01d89b06` — no MCP tool or script can do that part, so it is not allowed to block this phase.
- Phase 2's **Balance Sweep** job lands here, since it is the one that can exceed a ceiling.

Success: the run parks; approving on the phone resumes it; expiry cancels it and shows as such in the trace.

### Phase 4 — Standing mandate and revocation

An autonomous agent has no session to end, so containment has to be explicit.

- Mandate: **done in Phase 3, and not where this line expected.** `agentRestrictions` derives a read/write tier from tool risk and holds no number, so there was nothing to extend. The ceiling is declared on the agent's `scope-topology.json` entry and *enforced by the policy engine* (decision rule 0m + its cloud twin), not by the job that wants to spend. `agentMandate.js` only resolves what gets sent.
- Revocation: the existing kill switch + `agentLifecycleEvents` (joiner/mover/leaver, SailPoint forwarder) already covers "disable this agent". For an autonomous agent it must also cancel the schedule, not just deny the next tool call.
- Design reference already in repo: `docs/superpowers/specs/2026-06-27-agent-access-revocation-design.md`.

Success: killing an autonomous agent stops the next scheduled run, and the lifecycle event shows in the control-plane feed.

## What this plan deliberately does not do

- No new token type, no new grant, no AIP / transaction-token adoption. Those drafts are surveyed in [IETF-AGENT-AUTH-DRAFTS-2026.md](../docs/IETF-AGENT-AUTH-DRAFTS-2026.md); the demo's existing RFC 8693 + CIBA story covers autonomous-vs-worker without them.
- No agent-to-agent autonomy (an autonomous agent spawning autonomous agents). One level.
- No new UI surface. Class label goes on existing trace/roster surfaces.
- No change to any worker-agent path. Phase 2 adds a second entry point; it does not touch the chat one.

## Still open

1. What counts as an anomaly for Fraud Watch, and what does it do with one — activity-log entry, or something the user sees next sign-in?
2. Where the mandate ceiling is stored. `agentRestrictions` holds the tier today; the ceiling (amount, count, window) needs a home that the authorize path can read without a second round trip.
3. Whether an autonomous run should appear in the same Recent Runs list as worker runs (the mockup assumes yes) or a separate unattended feed.
