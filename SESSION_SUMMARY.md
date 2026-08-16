# AI-DEMO2 Bug Tracking Session — Handoff Summary

Session ran a repeated find→fix→PR→merge loop across AI-DEMO2 (banking demo, PingOne auth, RFC 8693 token exchange). 7 audit passes, 52 bugs found, 52 fixed. This doc is for a fresh agent picking up where this session left off.

## Where the tracker lives

**`BUGS.md`** — the master bug tracker (all 52 entries, full detail, fix evidence, PR links) — lives at repo root but **only on branch `worktree-bug-tracking-doc`**, via unmerged **PR #1803**. It was never merged to `main`. A new agent should either:
- Merge PR #1803 first so `BUGS.md` lands on `main`, or
- Read it directly from the worktree: `.claude/worktrees/bug-tracking-doc/BUGS.md`

## Status as of this handoff

- **52/52 bugs fixed** (passes 1–7). Full detail, code snippets, triggers, and fix descriptions are in `BUGS.md`.
- **Bugs #1–33**: all PRs merged into `main`, confirmed synced.
- **Bugs #34–52** (19 bugs, this session's later work): 18 PRs opened, **all 18 merged** into `main` and synced. (PR #1864 needed one conflict-resolution round in `REGRESSION_PLAN.md` §4 — resolved, tests re-verified 17/17, merged clean.)
- **Bug #39** (CivicPermit wrong-record fee payment) was already fixed by a **different concurrent session** (commit `eace36aaf`) before this session's audit pass reached it — no PR from this session, just a doc correction.

## Two Critical bugs found and fixed this session (highest priority context)

1. **#34** — `demo_authz_server/routes/rulesWrite.js`: the live authorization-policy write endpoint (`PUT /rules`) had **no real auth** in the default docker-compose deployment — `AUTHZ_ADMIN_TOKEN` was never configured anywhere and the code treated that as "guard inactive," assuming a loopback-only bind that docker-compose doesn't actually use (`HOST=0.0.0.0`, port 9001 published). Anyone on `localhost:9001` could rewrite money-transfer scope rules unauthenticated. Fixed: PR #1859 (merged) — fails closed on non-loopback bind, dev-default token added to compose.
2. **#44** — `demo_api_server/services/mcpWebSocketClient.js`: an undeclared `emit` reference in the `elicitation/create` handler threw `ReferenceError`, which the server's `uncaughtException` handler turned into `process.exit(1)` — **crashing the entire BFF process for every user** on any legitimate MCP elicitation flow. Fixed: PR #1869 (merged) — wired to the real `mcpFlowSseHub` publish mechanism, red-green verified (reproduced the crash before fixing).

## Other notable open items surfaced (not bugs, but worth knowing)

- **TECH_DEBT.md** now has an entry: the *default* MCP gateway path (Node, `ff_mcp_gateway_pinggateway` OFF) has an even bigger unpatched version of the HITL-receipt-replay bug (#35) than the Groovy/P1AZ path this session fixed — never calls `/verify` at all, so nothing marks a receipt consumed. Scoped out of #35's fix as too large a blast radius for a bounded fix; needs its own pass.
- **Banking resource-server IDOR fix (#45)** has no live UI consumer today (grepped, confirmed) — flagged for whoever wires it up next that real PingOne `sub` claims are UUIDs, not the demo's literal `"demo-user"` seed value.
- A `find 5 more, focus on UI` pass earlier found 5 UI bugs; a later broader pass found more. All are in `BUGS.md` passes 3–7 — no need to re-audit those areas from scratch.

## Infra state

- **Local docker-compose stack**: fully up and healthy (all ~25 containers, `ai-demo-*` naming) as of this session — the fixes are live locally.
- **SE Kubernetes deploy** (`./run-pingaws.sh`, shared `ping-devops-cmuir` namespace on `ping-dev-aws-us-east-2`): **never completed**. GHCR device-login auth (`gh auth refresh -h github.com -s write:packages`) was requested multiple times but the user never completed the browser step in time (codes expired 3+ times). If K8s deploy is still wanted, restart from `gh auth refresh` and complete the device code promptly, then follow the `se-k8-deploy` skill.
- Current worktree for this session: `.claude/worktrees/bug-tracking-doc`, branch `worktree-bug-tracking-doc`.

## How to continue the loop

The established pattern this session (repeatable): "find next N bugs" → dispatch parallel research agents (Agent tool, no isolation, read-only) scoped to unaudited files/areas (exclusion list grows each pass) → compile top N by severity → append a new `## Pass N` section to `BUGS.md` → "fix" → dispatch one isolated-worktree agent per bug (`isolation: "worktree"`) with full bug detail, instructed to check `regression-guard`/`verify-ai-demo2` skills, write tests, red-green verify, open a PR referencing `BUGS.md #N` → update `BUGS.md` status to Fixed with PR link → check CI on all PRs → merge → sync main checkout (`scripts/sync-main-checkout.sh`).

**Known friction**: fixer agents that background a full test-suite run tend to stall waiting passively on it (Monitor/background) instead of finishing. If an agent reports "waiting for background test run" as its final message, resume it with an explicit instruction to stop using Monitor/backgrounding and either run a scoped test synchronously or use already-passing scoped results as sufficient evidence.
