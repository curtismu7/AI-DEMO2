# Requirements — get_account_nickname + Actions chip

**Status:** Approved  
**Source answers:** `requirement-verification-questions.md` (pilot defaults applied 2026-07-09 when user said Continue with blank answers)  
**Depth:** Standard (brownfield feature; multi-component)

## Intent
Add a narrow read-only MCP tool that returns an account display nickname, plus an Actions chip that invokes it — as a teaching surface for single-field delegated reads. Do not redesign auth.

## Functional Requirements

| ID | Requirement | Trace |
|----|-------------|-------|
| FR-001 | MCP tool `get_account_nickname` returns the account display nickname for the resolved account | Q6-A |
| FR-002 | If nickname/display name is missing, return fallback string: account type + masked number (e.g. `Checking …1234`) | Q1-B |
| FR-003 | `accountId` is optional; if omitted, resolve the user's primary / first checking account | Q2-B |
| FR-004 | Tool uses user-delegated MCP via existing gateway path with `read` scope (same pattern as `get_my_accounts`) | Q3-A |
| FR-005 | Actions chip appears on banking Actions strip and Direct MCP teaching set alongside other core banking chips | Q4-C |
| FR-006 | Chip label: **Account nickname**; tool name `get_account_nickname` | Q5-A |
| FR-007 | Chat result uses the same human-readable formatting path as other Direct MCP / heuristic results (no raw JSON dump on success) | Q7-A |
| FR-008 | Construction includes MCP unit tests (handler + registry/scope map) and one UI chip wiring / chip-list assertion | Q8-B |

## Non-Functional Requirements

| ID | Requirement | Trace |
|----|-------------|-------|
| NFR-001 | Zero changes to token exchange, BFF session, or PingOne login paths | Q12-A |
| NFR-002 | Prefer existing BFF account APIs already used by `get_my_accounts` / balance tools; no new session APIs | Q12-A, reverse-eng |
| NFR-003 | Emoji allowlist and minimal-diff rules from REGRESSION_PLAN §0 | CLAUDE.md |
| NFR-004 | Construction edits only in a git worktree | CLAUDE.md |
| NFR-005 | Security Baseline extension **enabled** (blocking) for Construction stages | Q9-A |
| NFR-006 | Property-Based Testing extension **disabled** | Q10-C |
| NFR-007 | Resiliency Baseline extension **disabled** | Q11-B |
| NFR-008 | Tool is `readOnly: true`, `requiresUserAuth: true` in BankingToolRegistry | reverse-eng |

## Out of Scope
- Canceling the pilot in favor of only `get_my_accounts` (rejected: Q6-A)
- Public/unauthenticated catalog tool
- New verticals beyond banking / Direct MCP teaching set
- Write operations, HITL, or admin tools
- Full monorepo reverse-engineering refresh

## Acceptance Criteria (summary)
1. Authenticated demo user can click **Account nickname** and see a human-readable nickname or type+masked fallback.
2. `tools/call` for `get_account_nickname` succeeds with delegated `read` token through the gateway.
3. Omitting `accountId` still returns a nickname for the primary/first checking account.
4. No diffs under token-exchange / session / PingOne login protected paths.
5. Unit tests cover handler + registry/scopes; UI asserts chip presence.

## Open risks
- Confirm BFF account payload already exposes a nickname/display-name field; if not, map from existing `name` / type fields without new BFF endpoints (NFR-001/002).
- Chip list location must match current Actions config files (verify in Application Design).

## Approval
- [x] Approved as-is
- [ ] Approved with changes (list below)
- [ ] Reject — revise questions

**Changes requested:**
