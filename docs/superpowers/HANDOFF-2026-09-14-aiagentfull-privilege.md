# Handoff — AIAgentFull (Demo Steps parity + Privilege MCP/LLM) (2026-09-14)

Pick-up doc in case this dev environment restarts mid-session. Everything
below lives in the worktree
**`/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/agent-full-privilege-plan`**
on branch **`worktree-agent-full-privilege-plan`**.

## TL;DR

Planning is done and committed. **No implementation has started yet** — zero
of the 6 plan tasks are built. If you're picking this back up, the next step
is simply: resume with **superpowers:subagent-driven-development**, starting
at Task 1, using the plan file below.

## What this is

A new React component `AIAgentFull` (duplicate of the existing `AIAgent.js`,
which stays untouched) that adds a selectable "MCP transport" — Direct vs. Via
the PingOne Privilege AI Gateway — for tool calls, plus a disabled "Privilege
A2A — coming later" stub. Demo Steps and the Privilege LLM lane needed **no
new code** — both already exist in `AIAgent.js` today and come along for free
in the duplicate. A per-route allowlist decides whether `AIAgent` or
`AIAgentFull` mounts (default: `AIAgent`, unchanged everywhere).

## Where everything is

- **Spec:** `docs/superpowers/specs/2026-09-14-aiagentfull-privilege-design.md`
- **Plan:** `docs/superpowers/plans/2026-09-14-aiagentfull-privilege-mcp.md`
  (6 tasks, each with a failing test written first — full real code, no
  placeholders)
- Both committed on this worktree's branch: commit `f0cbae4bb`
  ("docs: spec + plan for AIAgentFull...").
- **SDD execution workspace** (ledger, per-task briefs/reports/reviews) will
  live at `.superpowers/sdd/2026-09-14-aiagentfull-privilege-mcp/` inside this
  worktree once execution starts — it's git-ignored, so check `progress.md`
  there (not git log) to see which tasks actually completed if this doc is
  out of date.

## Key decisions already made (don't re-ask)

1. `AIAgent.js` is **never modified** — `AIAgentFull.js` is a full duplicate.
2. **MCP transport scope: additive/low-risk (confirmed by user).**
   `AIAgentFull`'s "Via Privilege Gateway" tool calls hit the already-working
   standalone `/api/privilege-mcp-simple/tools/call` directly — zero changes
   to `mcpToolPipeline.js` or `/api/mcp/tool` (the protected, session-scoped
   pipeline with RFC 8693 exchange / PingOne Authorize / HITL / kill-switch —
   `REGRESSION_PLAN.md` §1). This means the Privilege path does **not** run
   the banking demo's consent/HITL/kill-switch checks — only Privilege's own
   policy applies. Full pipeline integration is intentionally deferred
   (Task 6 adds a `TECH_DEBT.md` entry for it).
3. **Component scope: full replica (confirmed by user).** `AIAgentFull`
   duplicates everything `AIAgent.js` (12,712 lines, exported as
   `BankingAgent`) currently does, not a leaner rebuild.
4. **Privilege LLM lane:** already fully built and working in `AIAgent.js`
   today via `AgentModeSelector` (`privilege_llm`/`privilege_claude` modes in
   `agentModeResolver.js` / `agentModes.js`) — nothing to build, just inherited
   by the duplicate.
5. **Privilege A2A:** explicitly out of scope / deferred — UI stub only.

## How to resume

Tell Claude: *"Continue the AIAgentFull plan using subagent-driven-development,
starting from wherever the ledger says."* Concretely:

1. `cd` into the worktree above (or `EnterWorktree` with
   `path: /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/agent-full-privilege-plan`).
2. Check for `.superpowers/sdd/2026-09-14-aiagentfull-privilege-mcp/progress.md`.
   - If it doesn't exist: nothing has been built yet — start Task 1 fresh per
     the plan file.
   - If it exists: its first line names the plan file (confirm it matches);
     resume at the first task with no `Task <N>: complete` line.
3. Re-invoke the `superpowers:subagent-driven-development` skill and follow
   its per-task dispatch/review loop against
   `docs/superpowers/plans/2026-09-14-aiagentfull-privilege-mcp.md`.

## Environment notes

- Node >= 22, plain JS/JSX in `demo_api_ui` (no TypeScript). Vitest 3.2, not
  Jest, for that package — `cd demo_api_ui && npm run test:unit && npm run build`
  is the gate.
- This worktree was created via `EnterWorktree` (name
  `agent-full-privilege-plan`), not `git worktree add` by hand — it should
  already be listed in `git worktree list` from the main checkout.
- No code has been touched outside `docs/`/`.superpowers/` yet — the six
  files the plan will create/modify are listed in the plan's task headers
  (`demo_api_ui/src/services/privilegeMcpService.js`,
  `demo_api_ui/src/hooks/useMcpToolTransport.js`,
  `demo_api_ui/src/utils/embeddedAgentFabVisibility.js`,
  `demo_api_ui/src/components/AIAgentFull.js`, `demo_api_ui/src/App.js`,
  `TECH_DEBT.md`).
