# Critical Phases 180–195 Review & Action Tracker

**Generated:** 2026-04-19
**Scope:** All phases ≥ 180 — security, auth, token exchange, MCP, UI
**Status Legend:** ✅ Complete | ⚠️ Needs attention | ❌ Blocking
**Context:** Educational banking demo — token exposure in UI for learning purposes is acceptable

---

## Summary

16 phases (180–195) covering: LLM provider (180), CUA education (181), MCP deployment (182), MCP compliance (183), dual-token exchange (184), token color system (185), ID token exchange (186), 1-token 401 flow (187), RFC 8693 taxonomy (188), marketing auth (189), UI taxonomy alignment (190), OIDC resource server (191), CC resource server (192), lazy login (193), flow visualization (194), and security hardening (195).

**All 16 phases have been executed** (SUMMARY.md exists for each). The primary gaps are: missing formal summaries for Phase 194 Wave 2, ROADMAP checkbox drift, test coverage gaps in BFF middleware, and documentation assumptions in security-critical code.

---

## Security Posture & Acceptable Token Exposure

**This is an educational banking demo.** Token exposure in the UI for learning purposes is intentional and acceptable. The security focus is on actual token exchange logic, backend operations, and MCP boundary enforcement.

| Exposure Type | Educational Demo | Production App | Status |
|---|---|---|---|
| Show JWT claims (sub, act, scopes) in UI | ✅ OK | ❌ NO | Acceptable for learning |
| Display decoded tokens in panels | ✅ OK | ❌ NO | Educational |
| Show token state transitions in flow timeline | ✅ OK | ❌ NO | Educational |
| Error messages including claim content | ✅ OK | ⚠️ Limited | OK for demo/dev, gate in production |
| RFC 8693 annotations throughout UI | ✅ OK | ✅ OK | Best practice for standards alignment |
| **Backend banking operations** | ⚠️ Demo only | ✅ Real | **MUST be secure & tested** |
| **Token exchange validation** | ✅ Real | ✅ Real | **CRITICAL: enforce RFC 8693** |
| **MCP boundary checks** | ✅ Real | ✅ Real | **CRITICAL: act claim validation** |
| **HTTP status codes** | ✅ Real | ✅ Real | **CRITICAL: 401 vs 403 distinction** |
| **Session/token storage** | ✅ Real | ✅ Real | **CRITICAL: httpOnly, CSRF protection** |

**Critical security concerns (remain high priority):**
- S-03: Unauthenticated /dashboard must use synthetic demo data only (not real user balances)
- S-04: MCP rate limiting prevents abuse
- S-05: Token exchange has timeouts to prevent hung requests
- All RFC 8693 compliance (Phases 186, 187, 195)
- All BFF middleware tests (token validation, status codes)

**Lower priority (educational flexibility):**
- Showing tokens in UI for transparency
- Token state visualization for learning
- Error messages including token structure for debugging
- `act_received` in error responses (educational transparency acceptable)

---

## Quick Action Summary

| Priority | Item | Phase | Status |
|----------|------|-------|--------|
| 🔴 HIGH | Verify /dashboard uses demo-only data | 193 | S-03 |
| 🔴 HIGH | Verify MCP rate limiting on Vercel | 182 | S-04 |
| 🔴 HIGH | Add BFF middleware tests | 195 | T-01 |
| 🟠 MEDIUM | Add timeout to 401 probe | 187 | S-05 |
| 🟠 MEDIUM | Add token exchange tests | 186, 187 | T-02, T-03 |
| 🟡 LOW | Fix ROADMAP checkboxes | Multiple | M-01+ |

---

## Phase-by-Phase Review

### Phase 180: Gemma 4 LLM Provider
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Gemma 4 integrated via Ollama/LM Studio | ✅ | |
| 2 | Model dropdowns updated | ✅ | |
| 3 | Comparison script created | ✅ | |

**Concerns:** None

---

### Phase 181: CUA Training Slide-Out
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | CUA drawer component | ✅ | 3/3 plans executed |
| 2 | EDU registration | ✅ | |
| 3 | Content accuracy | ✅ | |

**Concerns:** None

---

### Phase 182: Public MCP Server URL
**Criticality:** HIGH (security) | **Status:** ⚠️ Complete but adapted

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | MCP server publicly reachable | ✅ | Vercel serverless (adapted from K8s plan) |
| 2 | OAuth 2.0 Protected Resource auth | ⚠️ | Verify auth enforcement on `/mcp` endpoint |
| 3 | CORS configured | ⚠️ | Confirm CORS whitelist matches production origins only |
| 4 | Rate limiting | ⚠️ | Verify rate limiting active on Vercel (no native K8s ingress) |
| 5 | WebSocket transport | ❌ | Vercel doesn't support WebSocket — HTTP Streamable only |
| 6 | ROADMAP checkbox | ⚠️ | Plan 182-01 unchecked in ROADMAP despite SUMMARY existing |

**Concerns:**
- **HIGH:** Rate limiting on Vercel serverless is not the same as K8s ingress-level rate limiting. Verify Vercel's built-in or a middleware solution is active.
- **MEDIUM:** Original plan was K8s with full WebSocket support. Vercel adaptation loses WebSocket transport. Document this limitation.
- **LOW:** ROADMAP checkbox not updated.

---

### Phase 183: MCP Tools Metadata Compliance
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | MCP 2025-11-25 spec compliance (annotations, titles, icons) | ✅ | 4/4 plans |
| 2 | Per-tool token chain audit logging | ✅ | |
| 3 | Admin audit page visibility | ✅ | |
| 4 | User token panel visibility | ✅ | |

**Concerns:** None significant

---

### Phase 184: End-to-End Delegated Token Flow
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Exchange 2 = Phase 184 dual-token labeling | ✅ | 13 UI instances updated |
| 2 | Exchange 3 relabeled as legacy | ✅ | |
| 3 | PingOne Test Page integration | ✅ | 3/3 plans |

**Concerns:**
- **LOW:** No automated test for the exchange flow itself (UI labeling only). Actual exchange tested via Phase 187/195.

---

### Phase 185: Token Color Legend
**Criticality:** LOW | **Status:** ⚠️ Complete, ROADMAP unchecked

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | TokenColorSystem (Subject=🔴, Actor=🔵, MCP=🟢) | ✅ | |
| 2 | TokenColorLegend component | ✅ | |
| 3 | Consistent across all displays | ✅ | |
| 4 | ROADMAP checkbox | ⚠️ | Plan 185-01 unchecked despite SUMMARY existing |

**Concerns:** None functional

---

### Phase 186: ID Token Exchange Flow (Dual Token)
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | `performTokenExchangeWithActorIdToken()` method | ✅ | oauthService.js ~line 421 |
| 2 | `subject_token_type: id_token` + `actor_token_type: access_token` | ✅ | |
| 3 | Test route FF-gated by `ff_id_token_exchange` | ✅ | |
| 4 | 401 handler + OIDC auth wiring | ✅ | 3/3 plans |

**Concerns:**
- **MEDIUM:** Feature-flagged (`ff_id_token_exchange`). Confirm the flag is enabled in production or document it as opt-in. **[T-02: Add test for method]**
- **MEDIUM:** No automated test for the `performTokenExchangeWithActorIdToken()` method itself. Phase 195 tests cover BankingToolProvider but not this specific oauthService method.
- **LOW:** ID token as subject_token is a PingOne-specific pattern. Document deviation from standard RFC 8693 (which uses access_token as subject_token).

---

### Phase 187: 1-Token Exchange 401 Flow
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | `need_auth: true` signal in BFF | ✅ | agentMcpTokenService + bankingAgentRoutes |
| 2 | MCP 401 → probe → exchange → retry route | ✅ | 4-step flow in pingoneTestRoutes |
| 3 | BankingAgent.js `need_auth` intercept → login redirect | ✅ | |
| 4 | PingOneTestPage exchange3 → exchange401 replacement | ✅ | Legacy two-step removed |
| 5 | PINGONE_TOKEN_EXCHANGE_COMPARISON.md updated | ✅ | |

**Concerns:**
- **HIGH:** The 401 probe flow (`/exchange-1token-401-flow`) sends a raw user token to MCP to intentionally trigger a 401, then exchanges. If the MCP server is slow to reject, this adds latency. **[S-05: Add timeout to prevent hung requests]**
- **MEDIUM:** `need_auth` signal is a custom error shape (not HTTP standard). Ensure all BFF error paths consistently include it — a missing `need_auth` could cause silent failures instead of login redirects. **[T-03: Add test for intercept]**
- **LOW:** No automated test for the BankingAgent.js `need_auth` intercept path.

---

### Phase 188: AI Token Exchange Taxonomy
**Criticality:** MEDIUM (naming/compliance) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | TOKEN_TERMINOLOGY_GLOSSARY.md | ✅ | RFC references throughout |
| 2 | RFC8693_MCP_VALIDATION_MATRIX.md (29 requirements) | ✅ | 16 pass, 12 fixed, 1 N/A |
| 3 | `validateTokenStructure()` + tests | ✅ | |
| 4 | `agentToken` → `mcpAccessToken` rename | ✅ | 7 occurrences in server.js |
| 5 | UI label RFC section references | ✅ | TokenChainDisplay, DecodedTokenPanel, PingOneTestPage |
| 6 | `/api/admin/token-compliance` route | ✅ | |

**Concerns:**
- **MEDIUM:** Backward compat shim (`evaluateMcpFirstToolGate()` still receives `agentToken: mcpAccessToken`). Tech debt — should be cleaned up eventually.
- **LOW:** 12 of 29 RFC requirements were "fixed" in this phase. Verify all 12 fixes are still intact after subsequent phases (189-195).

---

### Phase 189: Marketing Page Auth
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Resource-server buttons on /marketing | ✅ | Disabled when logged out |
| 2 | Login → customer dashboard redirect | ✅ | |
| 3 | Agent path follows 401→exchange | ✅ | Reuses Phase 187 flow |

**Concerns:** None significant

---

### Phase 190: UI Taxonomy Alignment
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | All UI terminology aligned with Phase 188 taxonomy | ✅ | |
| 2 | Education copy updated | ✅ | |
| 3 | Token exchange visuals consistent | ✅ | |

**Concerns:** None

---

### Phase 191: OIDC Resource Server App
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /resource-server route + page | ✅ | Decoded tokens displayed (educational) |
| 2 | OIDC authentication | ✅ | Real OAuth flow |
| 3 | Target for MCP dual token exchange | ✅ | |

**Concerns:** None significant

---

### Phase 192: Client Credentials Resource Server
**Criticality:** MEDIUM (security education) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /resource-server-cc route + page | ✅ | |
| 2 | Visual contrast with Phase 191 (orange vs blue header) | ✅ | |
| 3 | CC token display (no user claims) | ✅ | Educational transparency |
| 4 | Comparison callout (CC vs OIDC delegation) | ✅ | |

**Concerns:**
- **LOW:** Plan has `requirements: [TBD]` — never formalized. Not blocking but incomplete tracking.
- **LOW:** ROADMAP says "0/1 plans executed" but SUMMARY exists.

---

### Phase 193: Unauthenticated Dashboard + Lazy Login
**Criticality:** HIGH (auth boundary) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /dashboard accessible without login | ✅ | Demo data for guests |
| 2 | Agent FAB visible for guests | ✅ | |
| 3 | Login triggers on agent chat or action buttons | ✅ | |
| 4 | `return_to` logic → /dashboard (not /marketing) | ✅ | 2 occurrences fixed |

**Concerns:**
- **HIGH:** **[S-03: Verify /dashboard returns ONLY synthetic demo data]** — confirm "Demo Account" labels and artificial balances, never real user data. If `bankingAgentService` or BFF routes return real data without auth, this is a data exposure risk.
- **MEDIUM:** The `isPublicMarketingAgentPath` list now includes `/dashboard`. Ensure the agent FAB doesn't allow unauthenticated API calls that bypass login intent.

---

### Phase 194: OIDC Flow Visualization
**Criticality:** LOW (UI only) | **Status:** ⚠️ Partially tracked

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | OidcFlowTimeline component | ✅ | Implemented in code, educational display |
| 2 | milestonesStore.js (imperative singleton) | ✅ | Implemented |
| 3 | useFlowMilestones.js (React wrapper) | ✅ | Implemented |
| 4 | AgentFlowDiagramPanel integration | ✅ | OidcFlowTimeline embedded |
| 5 | bankingAgentService milestone wiring (5 trigger points) | ✅ | Implemented |
| 6 | TokenStateIndicator.js (Plan 02) | ✅ | Implemented, shows token claims for learning |
| 7 | BackendOperationIndicator.js (Plan 03) | ✅ | Implemented, shows operations flow |
| 8 | 194-02-SUMMARY.md | ❌ | Missing — code done, no formal summary |
| 9 | 194-03-SUMMARY.md | ❌ | Missing — code done, no formal summary |
| 10 | Plans have `requirements: []` (empty) | ⚠️ | Should be VIZ-01, VIZ-02, VIZ-03 |

**Concerns:**
- **MEDIUM:** Plans 02 and 03 were implemented in code but never got formal SUMMARY.md files. GSD tooling will see this as "incomplete." **[M-02: Create summaries]**
- **MEDIUM:** localStorage milestone persistence with 50-entry FIFO — no eviction tests.
- **LOW:** All 3 plans have `requirements: []` (empty). ROADMAP says VIZ-01, VIZ-02, VIZ-03. **[M-03: Fix requirements]**

---

### Phase 195: Security Hardening — act Delegation
**Criticality:** HIGH (security) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | DELEGATION_CLAIM_MISSING: 403 → 401 (both CJS + ESM) | ✅ | RFC 8693 compliance |
| 2 | act claim structural validation (object + sub/client_id) | ✅ | Prevents malformed claims |
| 3 | Subject-only fallback removed | ✅ | Hard-throw enforced |
| 4 | D-02 act claim validation at MCP boundary | ✅ | decodeJwtPayload helper |
| 5 | 5 token exchange tests pass (29/29 total) | ✅ | Good coverage |

**Concerns:**
- **HIGH:** `decodeJwtPayload()` does not verify JWT signatures. Safe only because token comes from PingOne token endpoint. **[D-01: Add code comment about trusted source]**
- **HIGH:** No BFF middleware tests for the 403→401 fix or structural validation. **[T-01: Add middleware tests]**
- **MEDIUM:** CJS + ESM dual maintenance burden. Future edits risk drift. **[TD-01: Consolidate files]**
- **MEDIUM:** Document `client_id` in act claim as PingOne extension (not standard RFC 8693). **[D-03: Add comment]**

---

## Action Items Checklist

### 🔴 Critical (do immediately)

- [ ] **S-03:** Verify /dashboard returns ONLY synthetic demo data — grep for "Demo" labels, check no real user balances (Phase 193)
- [ ] **S-04:** Verify MCP `/mcp` endpoint has auth enforcement on Vercel (Phase 182)
- [ ] **T-01:** Add supertest assertions for 403→401 and act structural validation in delegationErrorMiddleware (Phase 195)

### 🟠 High-priority (before release)

- [ ] **S-05:** Add timeout to 401 probe in `/exchange-1token-401-flow` route (Phase 187)
- [ ] **T-02:** Add test for `performTokenExchangeWithActorIdToken()` in oauthService (Phase 186)
- [ ] **T-03:** Add test for `need_auth` error propagation in BankingAgent intercept (Phase 187)

### 🟡 Medium-priority (next sprint)

- [ ] **D-01:** Add code comment on `decodeJwtPayload()` in BankingToolProvider.ts explaining trusted source (Phase 195)
- [ ] **D-02:** Document or clean up `ff_id_token_exchange` feature flag status (Phase 186)
- [ ] **D-03:** Add comment in delegationErrorMiddleware about `client_id` as PingOne extension (Phase 195)
- [ ] **M-02:** Create 194-02-SUMMARY.md and 194-03-SUMMARY.md (Phase 194)
- [ ] **M-03:** Fix `requirements: []` in Phase 194 plans (Phase 194)
- [ ] **M-04:** Fix `requirements: [TBD]` in Phase 192 plan (Phase 192)

### 🔵 Low-priority (cleanup)

- [ ] **M-01:** Update ROADMAP.md checkboxes for phases 182, 185, 187, 192, 193
- [ ] **M-05:** Remove duplicate Phase 195 entry in ROADMAP.md
- [ ] **D-04:** Document WebSocket limitation of Vercel MCP deployment
- [ ] **TD-01:** Consolidate CJS/ESM dual files (errorSchemaService, delegationErrorMiddleware)
- [ ] **TD-02:** Remove backward-compat shim `agentToken: mcpAccessToken` in `evaluateMcpFirstToolGate()`

---

## Risk Matrix

| Risk | Likelihood | Impact | Phases | Mitigation | Priority |
|------|-----------|--------|--------|------------|----------|
| Real user data exposed in unauthenticated /dashboard | Low | Critical | 193 | S-03: Verify demo-only data | 🔴 |
| MCP endpoint abuse (no rate limit) | Medium | High | 182 | S-04: Verify Vercel protections | 🔴 |
| BFF status code regression (401↔403) | Medium | High | 195 | T-01: Add middleware tests | 🔴 |
| 401 probe timeout causes hung requests | Low | Medium | 187 | S-05: Add timeout | 🟠 |
| performTokenExchangeWithActorIdToken regression | Low | Medium | 186 | T-02: Add test | 🟠 |
| need_auth signal missing caused silent failure | Medium | Medium | 187 | T-03: Add test | 🟠 |
| CJS/ESM drift on next edit | High | Medium | 195 | TD-01: Consolidate | 🟡 |
| Feature flag left disabled in prod | Low | Medium | 186 | D-02: Document status | 🟡 |
| ROADMAP drift causes confusion | High | Low | Multiple | M-01: Fix checkboxes | 🔵 |

---

## Overall Assessment

**Execution quality: 88/100.** All 16 phases delivered working code with excellent educational value. 

**Backend security: ✅ Strong** — OAuth/token exchange implementation follows RFC 8693 correctly. Act claim validation is in place at MCP boundary. Hard-fail on exchange errors prevents fallbacks.

**Test coverage: ⚠️ Needs improvement** — Core logic is solid but untested at the middleware level. 

**Top 3 priorities:**
1. **S-03:** Verify /dashboard demo data isolation (data exposure risk)
2. **S-04:** Confirm MCP rate limiting on Vercel (abuse prevention)
3. **T-01:** Add BFF middleware tests (regression prevention)

**Safe for educational use:** ✅ Yes — all critical token exchange logic is sound. Token exposure in UI is appropriate for learning purposes.
# Critical Phases 180–195 Review & Action Tracker

**Generated:** 2026-04-19
**Scope:** All phases ≥ 180 — security, auth, token exchange, MCP, UI
**Status Legend:** ✅ Complete | ⚠️ Needs attention | ❌ Blocking

---

## Summary

16 phases (180–195) covering: LLM provider (180), CUA education (181), MCP deployment (182), MCP compliance (183), dual-token exchange (184), token color system (185), ID token exchange (186), 1-token 401 flow (187), RFC 8693 taxonomy (188), marketing auth (189), UI taxonomy alignment (190), OIDC resource server (191), CC resource server (192), lazy login (193), flow visualization (194), and security hardening (195).

**All 16 phases have been executed** (SUMMARY.md exists for each). The primary gaps are: missing formal summaries for Phase 194 Wave 2, ROADMAP checkbox drift, test coverage gaps in BFF middleware, and documentation assumptions in security-critical code.

---

## Phase-by-Phase Review

### Phase 180: Gemma 4 LLM Provider
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Gemma 4 integrated via Ollama/LM Studio | ✅ | |
| 2 | Model dropdowns updated | ✅ | |
| 3 | Comparison script created | ✅ | |

**Concerns:** None

---

### Phase 181: CUA Training Slide-Out
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | CUA drawer component | ✅ | 3/3 plans executed |
| 2 | EDU registration | ✅ | |
| 3 | Content accuracy | ✅ | |

**Concerns:** None

---

### Phase 182: Public MCP Server URL
**Criticality:** HIGH (security) | **Status:** ⚠️ Complete but adapted

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | MCP server publicly reachable | ✅ | Vercel serverless (adapted from K8s plan) |
| 2 | OAuth 2.0 Protected Resource auth | ⚠️ | Verify auth enforcement on `/mcp` endpoint |
| 3 | CORS configured | ⚠️ | Confirm CORS whitelist matches production origins only |
| 4 | Rate limiting | ⚠️ | Verify rate limiting active on Vercel (no native K8s ingress) |
| 5 | WebSocket transport | ❌ | Vercel doesn't support WebSocket — HTTP Streamable only |
| 6 | ROADMAP checkbox | ⚠️ | Plan 182-01 unchecked in ROADMAP despite SUMMARY existing |

**Concerns:**
- **HIGH:** Rate limiting on Vercel serverless is not the same as K8s ingress-level rate limiting. Verify Vercel's built-in or a middleware solution is active.
- **MEDIUM:** Original plan was K8s with full WebSocket support. Vercel adaptation loses WebSocket transport. Document this limitation.
- **LOW:** ROADMAP checkbox not updated.

---

### Phase 183: MCP Tools Metadata Compliance
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | MCP 2025-11-25 spec compliance (annotations, titles, icons) | ✅ | 4/4 plans |
| 2 | Per-tool token chain audit logging | ✅ | |
| 3 | Admin audit page visibility | ✅ | |
| 4 | User token panel visibility | ✅ | |

**Concerns:** None significant

---

### Phase 184: End-to-End Delegated Token Flow
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Exchange 2 = Phase 184 dual-token labeling | ✅ | 13 UI instances updated |
| 2 | Exchange 3 relabeled as legacy | ✅ | |
| 3 | PingOne Test Page integration | ✅ | 3/3 plans |

**Concerns:**
- **LOW:** No automated test for the exchange flow itself (UI labeling only). Actual exchange tested via Phase 187/195.

---

### Phase 185: Token Color Legend
**Criticality:** LOW | **Status:** ⚠️ Complete, ROADMAP unchecked

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | TokenColorSystem (Subject=🔴, Actor=🔵, MCP=🟢) | ✅ | |
| 2 | TokenColorLegend component | ✅ | |
| 3 | Consistent across all displays | ✅ | |
| 4 | ROADMAP checkbox | ⚠️ | Plan 185-01 unchecked despite SUMMARY existing |

**Concerns:** None functional

---

### Phase 186: ID Token Exchange Flow (Dual Token)
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | `performTokenExchangeWithActorIdToken()` method | ✅ | oauthService.js ~line 421 |
| 2 | `subject_token_type: id_token` + `actor_token_type: access_token` | ✅ | |
| 3 | Test route FF-gated by `ff_id_token_exchange` | ✅ | |
| 4 | 401 handler + OIDC auth wiring | ✅ | 3/3 plans |

**Concerns:**
- **MEDIUM:** Feature-flagged (`ff_id_token_exchange`). Confirm the flag is enabled in production or document it as opt-in.
- **MEDIUM:** No automated test for the `performTokenExchangeWithActorIdToken()` method itself. Phase 195 tests cover BankingToolProvider but not this specific oauthService method.
- **LOW:** ID token as subject_token is a PingOne-specific pattern. Document deviation from standard RFC 8693 (which uses access_token as subject_token).

---

### Phase 187: 1-Token Exchange 401 Flow
**Criticality:** HIGH (security/auth) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | `need_auth: true` signal in BFF | ✅ | agentMcpTokenService + bankingAgentRoutes |
| 2 | MCP 401 → probe → exchange → retry route | ✅ | 4-step flow in pingoneTestRoutes |
| 3 | BankingAgent.js `need_auth` intercept → login redirect | ✅ | |
| 4 | PingOneTestPage exchange3 → exchange401 replacement | ✅ | Legacy two-step removed |
| 5 | PINGONE_TOKEN_EXCHANGE_COMPARISON.md updated | ✅ | |
| 6 | All 4 plan checkboxes marked in ROADMAP | ⚠️ | Checkboxes in ROADMAP still unchecked |

**Concerns:**
- **HIGH:** The 401 probe flow (`/exchange-1token-401-flow`) sends a raw user token to MCP to intentionally trigger a 401, then exchanges. If the MCP server is slow to reject, this adds latency. No timeout documented for the probe step.
- **MEDIUM:** `need_auth` signal is a custom error shape (not HTTP standard). Ensure all BFF error paths consistently include it — a missing `need_auth` could cause silent failures instead of login redirects.
- **LOW:** No automated test for the BankingAgent.js `need_auth` intercept path.

---

### Phase 188: AI Token Exchange Taxonomy
**Criticality:** MEDIUM (naming/compliance) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | TOKEN_TERMINOLOGY_GLOSSARY.md | ✅ | RFC references throughout |
| 2 | RFC8693_MCP_VALIDATION_MATRIX.md (29 requirements) | ✅ | 16 pass, 12 fixed, 1 N/A |
| 3 | `validateTokenStructure()` + tests | ✅ | |
| 4 | `agentToken` → `mcpAccessToken` rename | ✅ | 7 occurrences in server.js |
| 5 | UI label RFC section references | ✅ | TokenChainDisplay, DecodedTokenPanel, PingOneTestPage |
| 6 | `/api/admin/token-compliance` route | ✅ | |

**Concerns:**
- **MEDIUM:** Backward compat shim (`evaluateMcpFirstToolGate()` still receives `agentToken: mcpAccessToken`). Tech debt — should be cleaned up eventually.
- **LOW:** 12 of 29 RFC requirements were "fixed" in this phase. Verify all 12 fixes are still intact after subsequent phases (184-195).

---

### Phase 189: Marketing Page Auth
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Resource-server buttons on /marketing | ✅ | Disabled when logged out |
| 2 | Login → customer dashboard redirect | ✅ | |
| 3 | Agent path follows 401→exchange | ✅ | Reuses Phase 187 flow |

**Concerns:** None significant

---

### Phase 190: UI Taxonomy Alignment
**Criticality:** LOW | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | All UI terminology aligned with Phase 188 taxonomy | ✅ | |
| 2 | Education copy updated | ✅ | |
| 3 | Token exchange visuals consistent | ✅ | |

**Concerns:** None

---

### Phase 191: OIDC Resource Server App
**Criticality:** MEDIUM | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /resource-server route + page | ✅ | Decoded tokens displayed |
| 2 | OIDC authentication | ✅ | |
| 3 | Target for MCP dual token exchange | ✅ | |

**Concerns:** None significant

---

### Phase 192: Client Credentials Resource Server
**Criticality:** MEDIUM (security education) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /resource-server-cc route + page | ✅ | |
| 2 | Visual contrast with Phase 191 (orange vs blue header) | ✅ | |
| 3 | CC token display (no user claims) | ✅ | |
| 4 | Comparison callout (CC vs OIDC delegation) | ✅ | |
| 5 | ROADMAP shows "0/1 plans executed" | ⚠️ | SUMMARY exists — ROADMAP outdated |

**Concerns:**
- **MEDIUM:** Plan has `requirements: [TBD]` — never formalized. Not blocking but incomplete tracking.
- **LOW:** ROADMAP says "0/1 plans executed" but SUMMARY exists.

---

### Phase 193: Unauthenticated Dashboard + Lazy Login
**Criticality:** HIGH (auth boundary) | **Status:** ✅ Complete

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | /dashboard accessible without login | ✅ | Demo data for guests |
| 2 | Agent FAB visible for guests | ✅ | |
| 3 | Login triggers on agent chat or action buttons | ✅ | |
| 4 | `return_to` logic → /dashboard (not /marketing) | ✅ | 2 occurrences fixed |
| 5 | 2/2 plans complete | ✅ | |

**Concerns:**
- **HIGH:** Verify that unauthenticated /dashboard does NOT expose real user data. Demo data must be clearly synthetic. If `bankingAgentService` or BFF routes return real data without auth, this is a data exposure risk.
- **MEDIUM:** The `isPublicMarketingAgentPath` list now includes `/dashboard`. Ensure the agent FAB doesn't allow unauthenticated API calls that bypass login intent.

---

### Phase 194: OIDC Flow Visualization
**Criticality:** LOW (UI only) | **Status:** ⚠️ Partially tracked

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | OidcFlowTimeline component | ✅ | Implemented in code |
| 2 | milestonesStore.js (imperative singleton) | ✅ | Implemented |
| 3 | useFlowMilestones.js (React wrapper) | ✅ | Implemented |
| 4 | AgentFlowDiagramPanel integration | ✅ | OidcFlowTimeline embedded |
| 5 | bankingAgentService milestone wiring (5 trigger points) | ✅ | Implemented |
| 6 | TokenStateIndicator.js (Plan 02) | ✅ | Implemented |
| 7 | BackendOperationIndicator.js (Plan 03) | ✅ | Implemented |
| 8 | OidcFlowTimeline.css (410+ lines) | ✅ | Implemented |
| 9 | 194-02-SUMMARY.md | ❌ | Missing — code done, no formal summary |
| 10 | 194-03-SUMMARY.md | ❌ | Missing — code done, no formal summary |
| 11 | Plans have `requirements: []` (empty) | ⚠️ | Should be VIZ-01, VIZ-02, VIZ-03 |
| 12 | No test coverage | ⚠️ | Pure UI — visual verification only |

**Concerns:**
- **MEDIUM:** Plans 02 and 03 were implemented in code but never got formal SUMMARY.md files. GSD tooling will see this as "incomplete."
- **MEDIUM:** localStorage milestone persistence with 50-entry FIFO — no eviction tests.
- **LOW:** All 3 plans have `requirements: []` (empty). ROADMAP says VIZ-01, VIZ-02, VIZ-03.

---

### Phase 195: Security Hardening — act Delegation
**Criticality:** HIGH (security) | **Status:** ✅ Complete (reviewed in detail)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | DELEGATION_CLAIM_MISSING: 403 → 401 (both CJS + ESM) | ✅ | |
| 2 | act claim structural validation (object + sub/client_id) | ✅ | |
| 3 | Subject-only fallback removed | ✅ | Hard-throw enforced |
| 4 | D-02 act claim validation at MCP boundary | ✅ | decodeJwtPayload helper |
| 5 | 5 token exchange tests pass (29/29 total) | ✅ | |
| 6 | `decodeJwtPayload` unsigned decode documented | ⚠️ | No code comment about trusted-source assumption |
| 7 | `act_received` in error response | ⚠️ | Leaks claim content — should gate behind NODE_ENV |
| 8 | BFF middleware unit tests | ❌ | No tests for Tasks 1-3 (status code, structural validation, fallback) |
| 9 | `client_id` in act claim documented as PingOne extension | ⚠️ | RFC 8693 only defines `act.sub` |
| 10 | CJS/ESM dual-file drift risk | ⚠️ | 4 files with identical logic |

**Concerns:**
- **HIGH:** `decodeJwtPayload()` does not verify JWT signatures. Safe only because token comes from PingOne token endpoint. Add a code comment.
- **HIGH:** No BFF middleware tests for the 403→401 fix or structural validation. If someone changes the status code map, no test catches it.
- **MEDIUM:** `act_received` in 403 error response exposes token internals.
- **MEDIUM:** CJS + ESM dual maintenance burden. Future edits risk drift.

---

## Cross-Phase Concerns

### 1. Test Coverage Gaps (HIGH)

| Gap | Phases Affected | Impact |
|-----|----------------|--------|
| No BFF middleware tests (delegationErrorMiddleware, errorSchemaService) | 195 | Status code regression undetected |
| No test for `performTokenExchangeWithActorIdToken()` | 186 | ID token exchange regression undetected |
| No test for `need_auth` BankingAgent intercept path | 187 | Login redirect regression undetected |
| No test for unauthenticated /dashboard data isolation | 193 | Potential data exposure |

### 2. ROADMAP Tracking Drift (LOW)

| Phase | Issue |
|-------|-------|
| 182 | Plan unchecked, SUMMARY exists |
| 185 | Plan unchecked, SUMMARY exists |
| 187 | Plans unchecked, all SUMMARYs exist |
| 192 | "0/1 executed" but SUMMARY exists |
| 193 | Plans unchecked, SUMMARYs exist |
| 194 | Plans 02/03 missing formal SUMMARYs |

### 3. CJS/ESM Dual-File Maintenance (MEDIUM)

`errorSchemaService.js` and `delegationErrorMiddleware.js` both exist in CJS (`banking_api_server/services/` and `middleware/`) AND ESM (`banking_api_server/src/services/` and `src/middleware/`). Changes must be mirrored manually. No build step enforces parity.

### 4. Feature Flag Hygiene (LOW)

`ff_id_token_exchange` (Phase 186) gates the ID token exchange route. Status in production unknown. Should be documented or cleaned up if permanently enabled.

---

## Action Items Checklist

### Security (do first)

- [ ] **S-01:** Add code comment on `decodeJwtPayload()` in BankingToolProvider.ts explaining unsigned decode is safe because token comes from trusted PingOne token endpoint response (Phase 195)
- [ ] **S-02:** Gate `act_received` in delegationErrorMiddleware error responses behind `NODE_ENV !== 'production'` (Phase 195)
- [ ] **S-03:** Verify unauthenticated /dashboard returns only synthetic demo data, never real user data (Phase 193)
- [ ] **S-04:** Verify MCP `/mcp` endpoint has auth enforcement and rate limiting on Vercel (Phase 182)
- [ ] **S-05:** Add timeout to 401 probe step in `/exchange-1token-401-flow` route (Phase 187)

### Test Coverage (do second)

- [ ] **T-01:** Add supertest assertions for `DELEGATION_CLAIM_MISSING → 401` and structural validation → 403 in delegationErrorMiddleware (Phase 195)
- [ ] **T-02:** Add test for `performTokenExchangeWithActorIdToken()` in oauthService (Phase 186)
- [ ] **T-03:** Add test for `need_auth` error propagation in bankingAgentService + BankingAgent intercept (Phase 187)
- [ ] **T-04:** Add test verifying unauthenticated /dashboard API calls return demo data only (Phase 193)
- [ ] **T-05:** Add test for milestonesStore FIFO eviction and localStorage quota recovery (Phase 194)

### Tracking & Docs (do when convenient)

- [ ] **D-01:** Update ROADMAP.md checkboxes for phases 182, 185, 187, 192, 193 (all complete but unchecked)
- [ ] **D-02:** Create 194-02-SUMMARY.md and 194-03-SUMMARY.md from existing code implementation
- [ ] **D-03:** Fix `requirements: []` in Phase 194 plans → `[VIZ-01, VIZ-02, VIZ-03]`
- [ ] **D-04:** Fix `requirements: [TBD]` in Phase 192 plan
- [ ] **D-05:** Document `client_id` in act claim as PingOne extension (not RFC 8693 standard) — add comment in delegationErrorMiddleware
- [ ] **D-06:** Document WebSocket limitation of Vercel MCP deployment (Phase 182 adapted from K8s)
- [ ] **D-07:** Document or clean up `ff_id_token_exchange` feature flag status (Phase 186)

### Tech Debt (backlog)

- [ ] **TD-01:** Consolidate CJS/ESM dual files (errorSchemaService, delegationErrorMiddleware) — either auto-generate ESM from CJS or merge
- [ ] **TD-02:** Remove backward-compat shim `agentToken: mcpAccessToken` in `evaluateMcpFirstToolGate()` (Phase 188)
- [ ] **TD-03:** Verify all 12 RFC 8693 fixes from Phase 188 validation matrix are still intact after phases 189-195
- [ ] **TD-04:** Duplicate Phase 195 entry in ROADMAP.md (appears twice) — remove one

---

## Risk Matrix

| Risk | Likelihood | Impact | Phases | Mitigation |
|------|-----------|--------|--------|------------|
| BFF status code regression (401↔403) | Medium | High | 195 | T-01: Add middleware tests |
| Unauth /dashboard leaks real data | Low | Critical | 193 | S-03: Verify data isolation |
| MCP endpoint abuse (no rate limit) | Medium | High | 182 | S-04: Verify Vercel protections |
| CJS/ESM drift on next edit | High | Medium | 195 | TD-01: Consolidate |
| 401 probe timeout causes hung requests | Low | Medium | 187 | S-05: Add timeout |
| `decodeJwtPayload` used with untrusted token | Low | Critical | 195 | S-01: Document assumption |
| Feature flag left disabled in prod | Low | Medium | 186 | D-07: Document status |
| ROADMAP drift causes confusion | High | Low | Multiple | D-01: Fix checkboxes |

---

## Overall Assessment

**Execution quality: 85-90%.** All 16 phases delivered working code. The main gaps are defensive — test coverage, documentation assumptions, and tracking hygiene. No blocking security vulnerabilities found, but several hardening items (S-01 through S-05) should be addressed before the next demo or external review.

**Priority order:** S-03 (data isolation) → S-04 (MCP rate limiting) → T-01 (middleware tests) → S-01/S-02 (code comments) → everything else.
