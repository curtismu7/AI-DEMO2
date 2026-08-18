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

## Cleared after the UI round

- **`saveMessage` seq bug — FIXED (PR #2036, merged + deployed).** Reads the seq
  from the last key segment; deterministic same-ms regression test.
- **FAB overlap — RESOLVED.** Investigation found the rail was never mounted, so no
  overlap existed. Per decision, the rail was WIRED UP (PR #2037): mounted for
  signed-in non-admins + `App--has-quick-nav` applied so the FAB geometry engages
  (verified on deployed CSS: FAB → 464px, flush below the 7×44 rail). Only the
  pixel-level signed-in visual is unconfirmed (customer sign-in is passkey — not
  headless-automatable); needs a human glance on `/dashboard`.

## Deferred §1 findings — batch 1 fixed

Clean, self-contained fixes done + deployed:
- **PR #2042** (mcp-gateway + mcp-proxy rebuilt): proxy tools/list cache TTL+bound;
  gateway SSE upstream teardown on client close; unknown-kid JWKS dedupe + rate cap.
- **PR #2043** (demo-api-server): introspection-not-configured propagation; OIDC
  nonce enforced when the ID token omits the claim.
- pkce-cookie `timingSafeEqual` was already fixed earlier in **PR #2017** (no-op).

## Deferred §1 — batch 2 fixed (LLM-proxy + Helix)

- **PR #2048 — LLM proxy** (router logic only, frozen surface honored): global
  swap-chain lock (cross-class swaps no longer unload each other); `pinOnly` marker
  so `:8093` is never a classification substitute. Merged — **on disk, not yet live
  in the running proxy** (deploy-live doesn't manage `llm-proxy`; owner rebuilds it
  deliberately: `docker compose up -d --build llm-proxy`).
- **PR #2050 — Helix** event-loop: `_generate` on a running loop now raises pointing
  at `_agenerate` (which every real caller uses) instead of freezing the loop.
  Merged + deployed (langchain-agent rebuilt).

## Deferred §1 — batch 3 (intent-token + olb)

- **PR #2055 — intent-token `no_signing_key`** (1622): turned out to be a
  deploy-wiring gap, not a missing key — the Node gateway validator already read
  `INTENT_TOKEN_SECRET || SESSION_SECRET`; it was just never written into the
  gateway `.env`. One-line env-writer fix (no new secret). Merged + deployed;
  effective when the gateway `.env` regenerates + `ff_mcp_gateway_pinggateway` flips.
- **PR #2054 — `olb` tools/list timeout** (1599): INSTRUMENTED, not cured (not
  reproducible on demand). Ruled out pool exhaustion (`MCP_WS_MAX_CONCURRENT` doesn't
  exist; fresh WS per request); added structured `reason/timeoutMs/elapsedMs/connectMs`
  diagnostics so the next occurrence produces data. Merged + deployed.

## Still deferred — need a decision (NOT blind-fixable)

- **caller-scope-miss** (1569) — entry says the scopeless request is deliberate;
  resolution is a product decision (grant scope vs deny with a better reason).
- **MCP-handshake on Node gateway** (1152) — needs an IG Groovy filter.
- **proxy protocol-version** (675) — depends whether the Node gateway is the intended
  upstream for `demo_mcp_proxy`.

## Other open (noted)

- `saveMessage` intra-ms seq is not zero-padded (11+-message single-ms burst would
  sort lexicographically) — unreachable given fsync spacing; noted only.
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
