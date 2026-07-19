# HANDOFF — typed free-text transfers dead-end at "Incomplete"

**Status:** open. Root cause located and proven; fix not attempted.
**Date:** 2026-07-18/19

## Symptom

In the agent chat, type `transfer $600 from checking to savings`, answer `yes`.
The agent replies with prose promising a device prompt, and the run ends at the
amber badge **"Step-up required — Incomplete"**. No approval modal ever opens.
`$300` behaves the same with "HITL consent — Incomplete".

The **Demo Steps chip** for the same use case works correctly: the
"Authorize Agent Transfer" modal opens ($600.00, threshold warning, OTP/audit
assurances) and the badge reads `step-up-required verified`. Verified live.

Enforcement is not affected — the tool refuses and nothing executes. This is a
missing approval affordance, not a missing check.

## Root cause (proven by instrumentation, not inference)

**Typed free-text chat uses the AG-UI route `POST /api/agent/run`, not
`/api/agent/invoke`.**

That single fact invalidates the obvious-looking fixes. `/api/agent/run` is the
AG-UI protocol path (`ff_agui_enabled`), which delegates reasoning to the agent
service and has it call back into the BFF at `/internal/agent-tool` for tool
execution. It never touches `processAgentMessage`'s LLM branch or
`resolveExecuteTool` in `demoAgentLangGraphService.js`.

Proof: a temporary `console.log` in `resolveExecuteTool` (both the
`executeBffTool` callback and the `executeToolFor` result) produced **zero
output** during a full typed run, while the BFF audit log showed
`POST /api/agent/run` and a `[BFF→P1AZ]` evaluation for `create_transfer`.

AG-UI signals a human-approval pause by having the agent emit
`RUN_FINISHED` with `outcome.type === 'interrupt'` — see `_recordTraceEvents`
in `demo_api_server/routes/agentRun.js` (~line 99), which persists
`status: 'suspended_hitl'` when it sees one. On this flow the agent never emits
that; it paraphrases the gate into prose and finishes normally, so the SPA has
nothing to open a modal from.

Also confirmed: PingOne returns `decision: PERMIT` carrying a **non-obligatory**
`HITL` statement (`code: "HITL"`, `hitlRequired: true`), not a denial. Something
converts that statement into `error: "step_up_required"` on the heuristic path;
the AG-UI path does not.

## Two failed fixes — do not repeat these

Both were merged, verified failing against the live UI, and reverted the same
day. Both had passing unit tests and zero effect, because they patched a route
this flow never executes.

1. Hooked `out.error` in `resolveExecuteTool` — reverted in `2409090f6`.
2. Hooked the raw MCP payload via `parseMcpToolPayload` (the same classifier the
   vertical path uses) — reverted after `0fea2645`.

Lesson: unit tests cannot tell you a hook is unreachable. Instrument the running
system and confirm the code is entered before writing a fix.

## Where the fix belongs

In the AG-UI pipeline, one of:

- **Agent service** — detect the HITL/step-up gate returned by
  `/internal/agent-tool` and emit an AG-UI `interrupt` outcome instead of
  narrating it. This matches the protocol `agentRun.js` already understands, and
  is most likely correct. Note the agent-service Docker build has failed
  silently before, leaving a stale image — always `docker exec … grep` to prove
  a rebuild landed.
- **BFF `agentRun.js`** — the BFF sees the gate at `/internal/agent-tool` and
  also proxies the SSE stream, so it could inject the interrupt event itself.
  Cheaper, but it means the BFF fabricating protocol events the agent did not
  send. Weigh before choosing.

## Reproducing

Sign in at `https://local.ping-devops.com:4000/dashboard` (see CLAUDE.md — the
`api.ping.demo` host will not hold a session). Open the agent, type
`transfer $600 from checking to savings`, then `yes`.

To confirm which route serves a flow:
`docker logs ai-demo-api-server --since 3m | grep "POST /api/agent/"`.

`/app` is bind-mounted to the **main checkout**, so a worktree change cannot be
tested live without staging the file into main and restarting. `docker exec …
grep` proves the FILE on disk, not the loaded process — only a restart reloads
it.
