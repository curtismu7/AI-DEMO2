# Status — Gateway Local Enforcement plan

**Full plan:** [2026-08-12-gateway-local-enforcement.md](2026-08-12-gateway-local-enforcement.md)
**Worktree:** `.claude/worktrees/gateway-local-enforcement-plan` (branch `worktree-gateway-local-enforcement-plan`)
**State as of 2026-08-12:** Plan written and self-reviewed. **Zero tasks implemented yet.** Nothing committed on the branch except this status file and the plan doc.

## What this is

Closing the gap between what real PingOne Authorize (P1AZ) can enforce and what the gateways (Node `demo_mcp_gateway/` + IG `ping-gateway/` groovy) enforce locally, for the 5 rules P1AZ's DSL structurally can't express (`snapshots/gen-authorize-snapshot.js:30-47`). Origin: user wants "do as much as we can at the gateway, since we want to use real P1AZ most of the time" — both gateways, all 5 gaps.

## What's already true in the codebase (no work needed)

- **D-05 multi-aud** — fully enforced on Node gateway already, unconditionally (`GatewayTokenPolicy.ts:117-144`).
- **RAR single-payee** — fully enforced on Node gateway already, unconditionally when `REQUIRE_RAR_INTENT=true` (`rarEnforce.ts:42-76`).
- Both are real gaps only on the **IG/groovy** side (Tasks 7 and 8).

## The 9 tasks (see full plan for code)

| # | What | Where | Status |
|---|---|---|---|
| 1 | iat max-age check | Node `tokenValidator.ts` | not started |
| 2 | `allowedScopes`/`isA2aDelegatedTool`/`a2aDelegatedScope` accessors | Node `scopeTopology.ts` | not started |
| 3 | Per-tool scope backstop, A2A-safe, runs even when P1AZ active | Node `toolScopes.ts` + both transports | not started |
| 4 | Tier (groupToTier) local enforcement | Node, both transports | not started |
| 5 | Forward resolved tier as 3 headers (`X-User-Tier`, `X-Tier-Max-Amount-Usd`, `X-Tier-Restricted-Tools`) | BFF `mcpGatewayClient.js` + WS equivalent | not started |
| 6 | Mount `scope-topology.json` + per-tool-scope backstop | groovy `p1az-decision.groovy` | not started |
| 7 | Local iat/nbf + D-05 multi-aud deny | groovy `p1az-decision.groovy` | not started |
| 8 | **RAR payee local deny — DEFAULT OFF, flagged** | groovy `p1az-decision.groovy` | not started, needs sign-off before enabling |
| 9 | Local tier deny | groovy `p1az-decision.groovy` | not started |

## Open decision — not yet answered when work paused

Two things the plan's handoff explicitly asked and the user hadn't answered before pausing:

1. **Execution approach:** subagent-driven (fresh subagent per task, review between tasks) vs inline (batch execution this session, checkpoints). Neither chosen yet.
2. **Task 8 scope:** should the RAR-payee local-deny code even be written in this pass (shipped default-off), or split out entirely and deferred until there's explicit sign-off to override the repo's own guard rail? `ping-gateway/scripts/check-groovy-params.sh:78-81` warns against exactly this pattern ("P1AZ decides").

## Known risk to keep front-of-mind on resume

Task 3's per-tool-scope backstop is **not safe to make unconditional without also porting the A2A delegated-scope + gateway-hop-scope-bypass logic** (both included in the plan's Task 3 code) — A2A specialist calls present a narrower delegated scope than a tool's generic `requiredScopes`, and a naive unconditional check would deny every real A2A call (5/5 calls on the Node gateway are A2A). Task 3's tests explicitly cover this; don't skip Step 1a (resolving a real A2A-delegated tool name from `scope-topology.json` to test against) when implementing.

## How to resume

1. `EnterWorktree` with `path: .claude/worktrees/gateway-local-enforcement-plan` (or re-enter by name if removed and recreated).
2. Read the full plan doc.
3. Get the execution-approach answer (see "Open decision" above) before starting Task 1.
4. Follow `superpowers:subagent-driven-development` or `superpowers:executing-plans` per the plan header, task-by-task, in dependency order (Task 3 needs Task 2; Task 4 needs Task 5's headers to be meaningful but can be built/tested standalone first; Task 8 depends on Task 7's `denyLocal` helper landing first).
