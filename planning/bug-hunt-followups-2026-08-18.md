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

## DONE — next round: 10 new bugs in Customer Dashboard UI + Backend

Two-investigator audit (customer dashboard UI + backend data plane), all 10
verified in source and logged in the TECH_DEBT round-2 block. Not yet fixed.

Backend (5): conversation summaries share the message key-prefix (history replays
a summary as newest); `createTransaction` clobbers caller `createdAt`/`status`;
GET history `limit` unsanitised (NaN defeats the 100 cap); `GET /accounts/my`
serves banking `CHASUS33`/branch defaults to every vertical; `investment`
`:accountId` ignored → 200 with the default portfolio.

UI (5): Email-OTP verify fires the agent-resume event unconditionally; CIBA
auto-initiate timers survive Dismiss/unmount → back-channel auth after cancel;
`agentTriggeredStepUp` never reset on failure paths (stale-state leak); QuickNav
stack-height off-by-one overrides the correct CSS default; run-story `<li>` keyed
by a 48-char prefix collides and drops a row.

**Backend 5/5 fixed — PR #2022, merged + deployed** (demo-api-server restarted).
CI caught 2 reds a scoped run missed (investment ownership over-strict; a
nondeterministic prune test) — both reconciled before merge. Fixing the backend
also surfaced a new latent bug now logged in TECH_DEBT: `saveMessage` reads the
seq from key segment `[4]` instead of `[3]`, so same-millisecond writes collide
and drop messages under load.

**UI 5/5 fixed — PR #2031 (step-up cluster #6-8) + PR #2028 (rendering #9-10),
both merged + deployed** (ui restarted). Notes: #9's JS override was inert dead
code (removed) — the real FAB overlap traces to never-applied `.App--has-quick-nav`
classes, still open as a protected-layout follow-up; the CIBA-poll retry path was
deliberately left intact so legit agent retries still resume.

## Remaining open (logged in TECH_DEBT, not started)

- `saveMessage` seq-index `[4]` vs `[3]` → same-ms writes drop messages under load.
- Demo-FAB overlap via never-applied `.App--has-quick-nav` / `.App--has-nav-dash`
  classes (the real cause behind round-2 #9).
- The 11 earlier deferred §1 findings (gateway proxy protocol/SSE, LLM-proxy
  routing, helix event-loop, introspection-not-configured, OIDC nonce, pkce cookie).
- Docs-refresh todo: re-verify cited line numbers post-merge; fix stale
  `demo_mcp_server` repo-map entry in CLAUDE.md.

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
