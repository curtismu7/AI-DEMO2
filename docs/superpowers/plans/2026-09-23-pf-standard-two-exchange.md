# PF Standard Two-Exchange Implementation Plan

> **For agentic workers:** Execute inline in this session using the approved inline preference. Keep the work on branch `fix/pf-standard-two-exchange`.

**Goal:** Make ordinary PF demo runs use the same two-hop delegated access-token semantics and final claim contract as P1 while keeping ID-JAG isolated to its explicit use case.

**Architecture:** Keep the shared two-exchange orchestration responsible for scopes, final audience intent, event reporting, and validation. Put PF credentials, endpoint authentication, policy-derived audience handling, and per-hop token calls in a PF provider adapter. No standard PF run may use ID-JAG or PingOne credentials.

**Tech Stack:** Node >=22, CommonJS, Express BFF, Jest.

**Spec:** `docs/superpowers/specs/2026-09-23-pf-standard-two-exchange-design.md`

## Global Constraints

- Preserve all PingOne behavior and its current two-exchange path.
- Preserve PF ID-JAG as a UC40-only path.
- Keep all access and actor tokens in the BFF.
- Do not send PingOne-specific `audience` parameters to PF when PF policy derives the output resource.
- Fail closed on missing PF hop configuration or a mismatched final audience.

---

### Task 1: Pin the normalized standard token contract

**Files:**
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.test.js`
- Modify: `demo_api_server/src/__tests__/agentMcpTokenService.pfCatalogParity.test.js`

- [x] Add a PF standard integration test proving two exchanges occur, use access-token types, and emit the common exchange events; confirm ID-JAG functions are not called.
- [x] Run the focused test and verify the two-hop PF path.

### Task 2: Add PF standard provider adapter and configuration

**Files:**
- Create: `demo_api_server/services/pfStandardTokenExchangeService.js`
- Modify: `demo_api_server/services/configStore.js`
- Modify: `demo_api_server/services/agentMcpTokenService.js`
- Modify: `demo_api_server/env.example`
- Modify: `demo_api_server/docs/FEDERATE-SETUP.md`

- [x] Add configuration accessors for the PF first-hop and second-hop exchange clients, AI-agent and MCP-service actor clients, intermediate audience, auth methods, and actor scopes.
- [x] Implement adapter methods for PF client-credentials actor-token acquisition and each access-token exchange. Omit request audience only for PF when the configured policy derives it.
- [x] Refactor the shared two-exchange orchestration to use provider boundaries while retaining the existing PingOne request path.
- [x] Route ordinary PF standard runs through both hops; route UC40 through existing ID-JAG path before the standard adapter.
- [x] Validate subject continuity, access-token type, scopes, final audience, and expected delegation actor roles; stop on mismatch.
- [x] Run focused tests (3 suites, 96 tests passed).

### Task 3: Preserve cross-provider and ID-JAG regressions

**Files:**
- Test: `demo_api_server/src/__tests__/agentMcpTokenService.test.js`
- Test: `demo_api_server/src/__tests__/agentMcpTokenService.pfCatalogParity.test.js`
- Test: `demo_api_server/src/__tests__/oauthService.idJag.test.js`
- Test: `demo_api_server/src/__tests__/oauthService.test.js`

- [x] Run focused OAuth/config regressions and confirm PingOne payload and PF ID-JAG call behavior (6 suites, 166 tests).
- [x] `git diff --check` passes; topology is not modified.
- [x] Update the `REGRESSION_PLAN.md` §4 entry.
- [ ] Commit only intended paths on `fix/pf-standard-two-exchange` after verification.

### Task 4: Configure and verify the live PF policy chain

**Files:**
- External: configured PingFederate OAuth clients and Token Exchange Processor Policies.

- [ ] Configure first-hop and second-hop clients with the respective access-token exchange policies and client-credentials grants for their actor tokens. **Blocked:** no accessible PF admin API/UI credentials in this environment.
- [ ] Configure the first policy to issue the canonical intermediate audience and tool-scope intersection. **Blocked:** no accessible PF admin API/UI credentials in this environment.
- [ ] Configure the second policy to issue the active mode's expected final audience and exact tool scopes, with a supported nested or flat actor claim. **Blocked:** no accessible PF admin API/UI credentials in this environment.
- [ ] Run a read-only standard PF demo step and inspect only decoded claims: `sub`, `aud`, `scope`, token type, and `act` roles. Run the explicit PF ID-JAG step and confirm its path remains separate.
- [ ] Do not claim full PF parity if PF policy config cannot produce the required actor chain or if any catalog step has not been verified.
