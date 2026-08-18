# Bug-hunt follow-ups — 2026-08-18

Tracks the open items from the five-service bug-hunt audit. Fixed items shipped
as grouped PRs; the rest are logged in `TECH_DEBT.md` (2026-08-18 audit block).

## Done this round (grouped PRs by area)

- [x] **PR #2000** — Scripts / infra, 6/6 (load-secrets subshell export,
      post-deploy-smoke wrong deployment name, test-use-cases false PASS,
      run-tests https healthz probe, pre-push read from /dev/tty,
      validate-config config.json coverage). `bash -n` clean.
- [x] **PR #2002** — Python agents (oauth_manager retry-catches-own-raise
      400/401/403; openai + pydantic bff_tool_adapter 30s→`BFF_TOOL_TIMEOUT_SECONDS`
      default 120 + no-retry guard). 50 tests pass (38+5+7).
- [x] **PR #2003** — UI, 6/6 (VerticalSwitcher auth-on-mount, DraggableModal
      StrictMode root, FloatingPanel portal→createRoot, mcpFlowSseClient onerror,
      EventStreamPanel AbortController cleanup, safeFetch refetch nonce).
      test:unit 3226 pass, build exit 0.
- [x] **PR #2001** — TECH_DEBT.md updated with all deferred/protected findings +
      this tracker.
- [x] **PR #2013** — first 2 deferred items cleared: MCP gateway WS-close hang
      (settle pending call before clearing timers) + unbounded introspection cache
      (bounded via `cacheInsertWithEviction`, 1000 cap, expired entries deleted).
      21 tests, merged + deployed (`mcp-gateway` rebuilt).

## TODO — next round: 10 new bugs in Customer Dashboard UI + Backend

Hunt a fresh batch (target 10) NOT already in TECH_DEBT, scoped to:

- **Customer dashboard UI** — `demo_api_ui` customer/user dashboard surfaces
  (`UserDashboard.js`, `UserDashboardPing2026.js`, `Dashboard.js`, the token
  rail, account/transaction/AI chips, use-case launcher on the customer path).
- **Backend** — `demo_api_server` routes/services on the customer data plane
  (transactions, accounts, conversations, use-cases, session/auth glue).

Exclude everything already in TECH_DEBT. Verify each in source (file:line +
concrete failure scenario) before listing.

## TODO — refresh reports/docs to current servers + codebase

Confirm the audit-referenced anchors still match live code, and fix stale docs:

- [ ] Re-verify every file:line cited in the 2026-08-18 TECH_DEBT block against
      current HEAD (line numbers drift as fixes land).
- [ ] Root `CLAUDE.md` repo map lists `demo_mcp_server/`, which does not exist —
      only `demo_mcp_resource_server/` and `oauth-mcp/`. Correct it.
- [ ] Re-check `REGRESSION_PLAN.md` §1/§4 references against current paths.
- [ ] After the fix PRs merge, re-point any TECH_DEBT entries whose line numbers
      moved, and drop entries the PRs actually closed.

## Security items to fast-track (decide first)

Two audit findings are security-relevant. Both now fixed (regression-guarded,
separate PRs, pending merge):

- [x] **transactions.js case-sensitive `type`** — `{"type":"Transfer"}` skipped
      PingOne-Authorize / HITL / step-up / write-scope. HIGH. **PR #2007** —
      normalize on ingest + regression test, REGRESSION_PLAN §4 logged.
- [x] **MCP gateway rate-limit keyed on unverified `sub`** — forged token starved
      a victim's per-tool bucket. **PR #2008** — limiter moved after token
      validation, keyed on verified subject (WS + HTTP) + regression test.
