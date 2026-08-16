# AI-DEMO2 Bug/Review Session — Handoff (2026-08-16)

Repeated find→fix→PR→merge loop over AI-DEMO2 (PingOne banking demo). This is the handoff for a continuing agent. **Read `BUGS.md` (same branch) for the full bug detail.**

## Where the docs live
`BUGS.md`, `CODE_REVIEW.md`, `SESSION_SUMMARY.md` are on branch **`worktree-bug-tracking-doc`** (worktree at `.claude/worktrees/bug-tracking-doc`). They were merged to `main` once via PR #1878; **later pass-9/pass-10 doc commits are on the branch, not yet re-merged** — open a fresh PR from this branch to land them (branch is docs-only, verified: `git log --name-only origin/main..HEAD` = only the 3 md files → merges cleanly, reverts no code).

## Bug tally: 75 tracked, 61 fixed+merged, 14 in-flight/pending
- **#1–61: all fixed and merged to `main`.** (8 audit passes + carryover.)
- **#62–75 (Pass 10, Agent Gateway focus): found + recorded, fixes IN FLIGHT — NOT all merged.** See below.

## Pass 10 (Agent Gateway) — exact fix state at handoff
2 High, 9 Medium, 3 Low. The user approved "fix all 14."
- **#70, #72 → PR #1890 OPEN** (per-caller cancel scoping + 413 body cap; 35 tests pass). Merge it once CI green. **⚠️ PR #1851 is a duplicate/parallel fix of #70 (cross-caller cancellation) from another session — reconcile: merge one, close the other, don't double-merge.**
- **#62,#63,#64 (UI) · #65,#66,#71 (demo_mcp_gateway enforcement) · #67,#68,#69 (demo_api_server BFF) · #73,#74,#75 (ping-gateway Groovy):** fixer subagents were dispatched near session end. In-process subagents do NOT survive into a new session, so **assume these are NOT done.** New agent: `gh pr list --state open`, merge any pass-10 PR that landed (title/body says `BUGS.md #<n>`), and **re-dispatch isolated-worktree fixers for the rest** — each bug's file:line + fix direction is in BUGS.md. Suggested batching (avoids intra-file conflicts): {62,63,64} UI 3 files · {65,66,71} gateway enforcement (shared files, one fixer) · {67,68,69} BFF mcpToolPipeline/mcpGatewayClient (one fixer) · {73,74,75} Groovy (one fixer, no test infra — verify by review).

### The 2 High-severity pass-10 bugs (prioritize)
- **#65** `demo_mcp_gateway/src/rarEnforce.ts:47` — empty `authorization_details: []` bypasses RAR intent-subset under `REQUIRE_RAR_INTENT` (caller sets `[]`, amount/payee checks skipped, both transports). Fix: treat `length===0` as missing → fail closed.
- **#67** `demo_api_server/services/mcpToolPipeline.js:1640-1698` — gateway-unreachable fails OPEN: a down/slow gateway routes every agent tool call (transfers included) through `callToolLocal`, bypassing ALL policy. Fix: don't local-fall-back on gateway transport errors when `useGateway`; return 503/504 (or gate behind existing `ff_local_fallback_on_exchange_failure` opt-in).

## Code review deliverable
`CODE_REVIEW.md` on the branch holds: (1) the earlier 5-component design review, and (2) pass-10 gateway review observations (HTTP/WS enforcement hand-mirrored → drift; intent-token `permitted_tools` not locally enforced; delegated-consent revocation possibly bypassed in gateway mode; RFC 8693 subject-swap only warns; IG↔Node parity by prose with no golden-payload test; ~65KB untested `p1az-decision.groovy`; mermaid loose-mode; brittle SSE parse). None fixed yet — they're refactors, not bounded bugs.

## Standing blockers / gotchas
- **Local `sync-main-checkout.sh` is BLOCKED**: the shared main checkout has ANOTHER session's uncommitted work — `demo_api_server/middleware/activityLogger.js` (a `transactionHop`/`emitHop` "backend.request" ledger integration) + untracked `demo_api_server/tests/middleware/`. Verified it DIFFERS from `main` (real WIP, not leftover) — **do not clobber it.** Sync stays blocked until that session commits/stashes. Local checkout is ~22 commits behind `origin/main` (docs + delegatedCommerce/mastra fixes) but gateway files are current.
- **To get specific already-merged fixes running locally without a full sync**: `git checkout origin/main -- <path>` for just those files (surgical), then restart the affected Docker container. This was done for #55/#59 (`ai-demo-api-server` restarted, healthy).
- **SE K8s deploy is LIVE**: https://ai-demo.ping-devops.com (namespace `ping-devops-cmuir`, 17 pods Running). Built before pass-9/10 fixes. ⚠️ shared cluster — `./run-k8.sh se-undeploy` when done.
- **Local Docker stack**: up; `ai-demo-api-server` healthy. mastra_agent NOT in the running local stack.

## Workflow that's been working
Hunt = parallel read-only Agent tasks scoped to unaudited areas (append a `## Pass N` to BUGS.md). Fix = one `isolation:"worktree"` Agent per bug/bug-group, told to invoke `regression-guard`/`verify-ai-demo2`, write tests, red-green, open a PR `Ref: BUGS.md #N`. Then CI-check → `gh pr merge --merge` → `scripts/sync-main-checkout.sh`.
**Known friction:** fixer agents that background a full test suite stall on a 600s stream watchdog — instruct them to use SCOPED tests only and never run anything >90s in the foreground. Network cert/reset blips also intermittently kill subagents; just relaunch.
