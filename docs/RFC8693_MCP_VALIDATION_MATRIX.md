# RFC 8693 + MCP Token Exchange Validation Matrix

> **Purpose:** Audit trail mapping every RFC 8693 normative requirement to its implementation status, code location, and verification method. Cross-references MCP 2025-11-25 spec where applicable.

---

## RFC 8693 §2.1 — Subject Token

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 2.1-01 | `subject_token` present in exchange request | ✓ | `oauthService.js:performTokenExchange()` — URLSearchParams includes `subject_token` | `grep "subject_token" banking_api_server/services/oauthService.js` |
| 2.1-02 | `subject_token_type` specifies token format | ✓ | `oauthService.js` — set to `urn:ietf:params:oauth:token-type:access_token` or `id_token` | `grep "subject_token_type" banking_api_server/services/oauthService.js` |
| 2.1-03 | Subject token represents the identity being acted upon | ✓ | User's PingOne access/ID token used as subject | Trace from user auth → exchange call |
| 2.1-04 | Subject token validated before exchange | ⚠ | PingOne validates at exchange time; no local pre-validation | **Phase 188:** `validateTokenStructure()` adds local pre-check |

## RFC 8693 §2.2 — Actor Token

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 2.2-01 | `actor_token` present in delegation flows | ✓ | `oauthService.js:performTokenExchangeWithActor()` includes `actor_token` | `grep "actor_token" banking_api_server/services/oauthService.js` |
| 2.2-02 | `actor_token_type` specifies format | ✓ | Set to `urn:ietf:params:oauth:token-type:access_token` | `grep "actor_token_type" banking_api_server/services/oauthService.js` |
| 2.2-03 | `act` claim present in result token (delegation) | ⚠ | Should be present per PingOne exchange; not validated locally | **Phase 188:** `validateTokenStructure(token, { isDelegationFlow: true })` checks `act` |
| 2.2-04 | `act` claim structure: `{ "sub": "<actor-id>" }` per §4.1 | ⚠ | PingOne produces this; not validated locally | **Phase 188:** validate `act` is non-empty string or object with `sub` |
| 2.2-05 | Actor token optional in single-exchange flows | ✓ | `performTokenExchange()` (1-exchange) omits actor_token | Method signature has no actorToken param |

## RFC 8693 §2.3 — Resource and Audience

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 2.3-01 | `audience` parameter in exchange request | ✓ | All exchange methods include `audience` param | `grep "audience:" banking_api_server/services/oauthService.js` |
| 2.3-02 | `aud` claim in result matches requested audience | ⚠ | Not validated locally after exchange | **Phase 188:** `validateTokenStructure(token, { expectedAudience })` checks `aud` |
| 2.3-03 | Audience URIs configured correctly | ✓ | `.env`: `AI_AGENT_AUDIENCE`, `AGENT_GATEWAY_AUDIENCE` | `grep "AUDIENCE" banking_api_server/.env` |

## RFC 8693 §3.1 — Token Exchange Request

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 3.1-01 | `grant_type` = `urn:ietf:params:oauth:grant-type:token-exchange` | ✓ | `oauthService.js` — all exchange methods | `grep "grant-type:token-exchange" banking_api_server/services/oauthService.js` |
| 3.1-02 | `requested_token_type` specified | ✓ | Set to `urn:ietf:params:oauth:token-type:access_token` | Present in exchange request body |
| 3.1-03 | `scope` parameter included | ✓ | Scopes passed from config/caller | `grep "scope:" banking_api_server/services/oauthService.js` |
| 3.1-04 | Client authentication included | ✓ | `client_id` + secret via `applyAdminTokenEndpointClientAuth()` | Auth method applied per config |

## RFC 8693 §3.2 — Token Exchange Response

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 3.2-01 | `access_token` in response | ✓ | Extracted: `response.data.access_token` | `grep "access_token" banking_api_server/services/oauthService.js` |
| 3.2-02 | `sub` claim in result token | ⚠ | Should be present; not validated locally | **Phase 188:** `validateTokenStructure()` mandates `sub` |
| 3.2-03 | `exp` claim (expiry) in result token | ⚠ | Should be present; not validated locally | **Phase 188:** `validateTokenStructure()` checks `exp` > now |
| 3.2-04 | `scope` claim reflects requested scopes | ⚠ | Not validated locally | **Phase 188:** `validateTokenStructure()` checks scope intersection |

## RFC 8693 §4.1 — Actor Claim (`act`)

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 4.1-01 | `act` claim identifies the actor in delegation | ⚠ | Present when PingOne produces it; not validated | **Phase 188:** mandatory in dual-exchange validation |
| 4.1-02 | `act` claim can be nested (actor chain) | N/A | Demo uses single-level delegation | Out of scope |

## RFC 8693 §4.2 — May-Act Claim (`may_act`)

| # | Requirement | Status | Implementation | Verification |
|---|------------|--------|---------------|--------------|
| 4.2-01 | `may_act` indicates permitted actors | ⚠ | Implemented in Phase 58; validation varies | Check: does subject token contain `may_act`? |

---

## MCP 2025-11-25 Spec Alignment

| # | MCP Requirement | Status | Implementation | Verification |
|---|----------------|--------|---------------|--------------|
| MCP-01 | Bearer token in tool request `Authorization` header | ✓ | `agentMcpTokenService.js` passes token to MCP client | Token present in MCP WebSocket/HTTP2 requests |
| MCP-02 | `act` claim identifies agent for audit logging | ⚠ | Token has `act`, but MCP server may not validate | **Phase 188:** MCP-side `validateTokenAtGateway()` |
| MCP-03 | `aud` claim matches MCP server audience | ⚠ | Not validated at MCP server | **Phase 188:** MCP-side audience validation |
| MCP-04 | 401 response triggers auth challenge flow | ✓ | Auth challenge handler in MCP server | Existing implementation |
| MCP-05 | 403 for invalid scopes | ✓ | Scope checking exists | Existing implementation |
| MCP-06 | Token expiry respected | ⚠ | PingOne validates; local check missing | **Phase 188:** `validateTokenStructure()` checks `exp` |

---

## Validation Summary

| Category | Total | ✓ Passing | ⚠ Needs Fix | N/A |
|----------|-------|-----------|-------------|-----|
| §2.1 Subject Token | 4 | 3 | 1 | 0 |
| §2.2 Actor Token | 5 | 3 | 2 | 0 |
| §2.3 Resource/Audience | 3 | 2 | 1 | 0 |
| §3.1 Request | 4 | 4 | 0 | 0 |
| §3.2 Response | 4 | 1 | 3 | 0 |
| §4.1 Act Claim | 2 | 0 | 1 | 1 |
| §4.2 May-Act | 1 | 0 | 1 | 0 |
| MCP Spec | 6 | 3 | 3 | 0 |
| **Total** | **29** | **16** | **12** | **1** |

**Phase 188 addresses all 12 ⚠ items** via `validateTokenStructure()` function and MCP-side gateway validation.

---

*Last updated: 2026-04-18 | Phase 188: Token Exchange Taxonomy*
