# Super Banking — RFC & Standards Reference

> **Who this is for:** Security architects, evaluators, and SEs who need to verify exactly which standards the demo implements and how.
>
> **Honesty policy:** Every entry below is verified against source code. Compliance levels are accurate — no inflated claims. Known gaps are documented explicitly.

---

## Quick-Reference Table

| RFC / Standard | Title | Status | Demo Entry Point |
|---|---|---|---|
| RFC 6749 | OAuth 2.0 Authorization Framework | ✅ Full | Login → Token Chain |
| RFC 6750 | Bearer Token Usage | ✅ Full | Every API call |
| RFC 7009 | OAuth 2.0 Token Revocation | ✅ Full | Logout → OAuth Log |
| RFC 7519 | JSON Web Token (JWT) | ✅ Full | Token Chain → expand any token |
| RFC 7636 | Proof Key for Code Exchange (PKCE) | ✅ Full | Login → OAuth Log `code_challenge` |
| RFC 7662 | OAuth 2.0 Token Introspection | ✅ Full | Admin → Token Inspect tab |
| RFC 8693 | OAuth 2.0 Token Exchange | ✅ Full | Agent tool call → Token Chain |
| RFC 8707 | Resource Indicators for OAuth 2.0 | ✅ Partial | `audience` in every exchange request |
| RFC 9126 | OAuth 2.0 Pushed Authorization Requests (PAR) | ✅ Full | Config → `use_par=true` |
| RFC 9700 | OAuth 2.0 Security BCP | ✅ Applied | Login + exchange — state, nonce, PKCE |
| RFC 9396 | OAuth 2.0 Rich Authorization Requests (RAR) | 📋 Referenced | Education panel only |
| RFC 9728 | OAuth 2.0 Protected Resource Metadata | ✅ Full | `/.well-known/oauth-protected-resource` |
| OpenID Connect Core 1.0 | OIDC ID Token + UserInfo | ✅ Full | Login → `id_token` validation |
| OpenID CIBA Core 1.0 | Client-Initiated Backchannel Authentication | ✅ Full | Transfer >$500 → CIBA challenge |
| MCP Spec (2025-03-26) | Model Context Protocol | ✅ Full | Banking Agent → MCP Inspector |
| RFC 8693 §4.1 | `act` / `may_act` delegation claims | ✅ Full | 2-exchange path → JWT viewer |
| OIDC Discovery | OpenID Connect Discovery 1.0 | ✅ Full | `/.well-known/openid-configuration` |
| RFC 8705 | Mutual TLS Client Authentication | ⬜ Not implemented | — |
| RFC 9449 | DPoP (Demonstrating Proof of Possession) | ⬜ Not implemented | — |
| FAPI 2.0 | Financial-grade API Security | ⬜ Partial inspiration | PKCE + PAR + MTLS gap |

---

## RFC 6749 — OAuth 2.0 Authorization Framework

**Spec:** https://datatracker.ietf.org/doc/html/rfc6749  
**Status:** ✅ Full  
**Compliance notes:** All grant types required by the demo are implemented. Implicit grant is not used (deprecated per RFC 9700).

### Grant types implemented

| Grant Type | Used for | Location |
|---|---|---|
| Authorization Code | User login | `banking_api_server/routes/auth.js` |
| Client Credentials | Agent actor token (2-exchange path) | `banking_api_server/services/oauthService.js` |
| Refresh Token | Silent session renewal | `banking_api_server/middleware/tokenRefresh.js` |
| Token Exchange (RFC 8693) | MCP agent delegation | `banking_api_server/services/agentMcpTokenService.js` |
| CIBA (OpenID extension) | Backchannel step-up | `banking_api_server/routes/ciba.js` |

### How to demo

1. Login → OAuth Log shows `POST /token grant_type=authorization_code`
2. Admin → Token Chain → expand login event → see all three tokens

---

## RFC 7636 — Proof Key for Code Exchange (PKCE)

**Spec:** https://datatracker.ietf.org/doc/html/rfc7636  
**Status:** ✅ Full  
**Compliance notes:** `code_challenge_method=S256` enforced. `code_verifier` stored in BFF session (server-side only — never touches browser). PKCE cookie fallback for Vercel cross-instance sessions.

### How it's implemented

- `code_verifier`: `crypto.randomBytes(64).toString('hex')` — `banking_api_server/services/oauthService.js`
- `code_challenge`: `base64url(sha256(verifier))`
- Stored in `req.session.oauthCodeVerifier` + PKCE HMAC cookie (Vercel failsafe)
- Verified in callback: `state` match + `code_verifier` retrieval before `POST /token`

### What you can demo

OAuth Log → login callback → see `code_verifier` sent to `/token`, `code_challenge` in the original redirect.

---

## RFC 8693 — OAuth 2.0 Token Exchange

**Spec:** https://datatracker.ietf.org/doc/html/rfc8693  
**Status:** ✅ Full  
**Compliance notes:** Both paths (1-exchange and 2-exchange) implemented. `subject_token_type` and `requested_token_type` are `urn:ietf:params:oauth:token-type:access_token` per spec.

### 1-Exchange path (default)

```
POST /token
grant_type = urn:ietf:params:oauth:grant-type:token-exchange
subject_token = <user_access_token>
subject_token_type = urn:ietf:params:oauth:token-type:access_token
requested_token_type = urn:ietf:params:oauth:token-type:access_token
audience = <mcp_resource_uri>
scope = banking:accounts:read [banking:write if tool requires]
```

PingOne returns a narrow-scoped token for the MCP server audience. The user's broad session token stays in the BFF session.

### 2-Exchange path (`ff_two_exchange_delegation=true`)

Four steps — two CC acquisitions, two RFC 8693 exchanges:

Step 1 — AI Agent gets CC actor token (audience = Agent Gateway):
```
POST /token  grant_type=client_credentials  client_id=<ai_agent_client_id>
→ agent_actor_token { aud: agent_gateway_uri }
```

Step 2 — Exchange #1: Subject + Agent actor → Agent Exchanged Token (intermediate):
```
POST /token  [authenticated as ai_agent_client_id]
grant_type = urn:ietf:params:oauth:grant-type:token-exchange
subject_token = <user_access_token>       # may_act.sub must equal ai_agent_client_id
actor_token   = <agent_actor_token>
audience      = <intermediate_audience>
→ agent_exchanged_token { sub: user_id, act: { sub: "ai_agent_client_id" } }
```

Step 3 — MCP Service gets CC actor token (audience = MCP Gateway):
```
POST /token  grant_type=client_credentials  client_id=<mcp_exchanger_client_id>
→ mcp_actor_token { aud: mcp_gateway_uri }
```

Step 4 — Exchange #2: Agent Exchanged Token + MCP actor → Final MCP Token:
```
POST /token  [authenticated as mcp_exchanger_client_id]
grant_type = urn:ietf:params:oauth:grant-type:token-exchange
subject_token = <agent_exchanged_token>   # act.sub must equal mcp_exchanger_client_id
actor_token   = <mcp_actor_token>
audience      = <mcp_resource_uri>
→ final_token { sub: user_id, aud: mcp_uri,
                act: { sub: "mcp_exchanger_client_id",
                       act: { sub: "ai_agent_client_id" } } }  # when PingOne SpEL supports nesting
```

### Key files

- `banking_api_server/services/agentMcpTokenService.js` — orchestrates both paths
- `banking_api_server/services/oauthService.js` — `performTokenExchange()`
- `banking_api_server/server.js` — `/api/mcp/tool` proxy endpoint

### What you can demo

Agent tool call → Token Chain → expand **Token Exchange** event → see subject token, scope narrowing, issued MCP token with `aud` = MCP server.

### Known gaps / simplifications

- Token exchange response token is not re-validated via JWKS before use (trusts PingOne TLS)
- `actor_token_type` is set to `access_token` — spec also allows `jwt` type

---

## RFC 8693 §4.1 — `may_act` and `act` Claims

**Spec:** https://datatracker.ietf.org/doc/html/rfc8693#section-4.1  
**Status:** ✅ Full  
**Compliance notes:** `may_act` is injected by PingOne via attribute mapping on the resource server. `act` claim appears in 2-exchange MCP tokens. The 2-exchange path produces a two-level nested `act` chain (`act.sub` = MCP Service, `act.act.sub` = AI Agent). Full nesting is verified when PingOne SpEL evaluates correctly; a fallback single-level `act.sub` is recorded when SpEL cannot construct the nested object (see `docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md §1e`).

### How it's implemented

- `may_act: { client_id: <bff_admin_client_id> }` — set in PingOne resource server attribute mappings
- Checked by BFF before attempting exchange: `banking_api_server/services/agentMcpTokenService.js` `ff_inject_may_act` path
- `act` claim in issued MCP token when 2-exchange path is used
- Verified end-to-end in `docs/ACT_CLAIM_VERIFICATION.md`

### What you can demo

2-exchange path → JWT viewer → show `act.sub = agent_client_id` in the MCP token.

---

## RFC 7009 — Token Revocation

**Spec:** https://datatracker.ietf.org/doc/html/rfc7009  
**Status:** ✅ Full  
**Compliance notes:** Both `access_token` and `refresh_token` are revoked on logout. `token_type_hint` is sent. PingOne API resource tokens cannot be revoked (PingOne limitation — documented in code).

### How it's implemented

- `banking_api_server/routes/auth.js` — logout handler calls `oauthService.revokeToken()` for both tokens
- `banking_api_server/services/oauthService.js` — `POST /revoke` with Basic auth

---

## RFC 7662 — Token Introspection

**Spec:** https://datatracker.ietf.org/doc/html/rfc7662  
**Status:** ✅ Full

### What you can demo

Admin → Token Inspect → paste any access token → BFF calls `POST /introspect` → response shows `active`, `scope`, `sub`, `exp`.

---

## RFC 9126 — Pushed Authorization Requests (PAR)

**Spec:** https://datatracker.ietf.org/doc/html/rfc9126  
**Status:** ✅ Full  
**Compliance notes:** When `use_par=true`, the BFF sends the authorization request body to `/as/par` first, gets a `request_uri`, then redirects the browser with only `client_id` + `request_uri`. Full parameter confidentiality.

### How it's implemented

- `banking_api_server/config/oauthUser.js` — `authorizeUsesPiFlow` / `use_par` flag
- `banking_api_server/services/oauthService.js` — `submitPAR()` method
- `banking_api_server/routes/auth.js` — PAR path in login handler

### What you can demo

Config → `use_par=true` → login → OAuth Log → see `POST /par` request before redirect. Browser redirect URL contains only `request_uri`.

---

## RFC 9728 — OAuth 2.0 Protected Resource Metadata

**Spec:** https://datatracker.ietf.org/doc/html/rfc9728  
**Status:** ✅ Full

### How it's implemented

- Endpoint: `GET /.well-known/oauth-protected-resource`
- Returns: `resource`, `authorization_servers[]`, `bearer_methods_supported`, `scopes_supported`, `jwks_uri`
- CORS: `Access-Control-Allow-Origin: *`
- Cache: `Cache-Control: public, max-age=3600`
- File: `banking_api_server/routes/protectedResourceMetadata.js` (mounted at both `/.well-known/oauth-protected-resource` and `/api/rfc9728` in `server.js`)

### What you can demo

Navigate to `https://<your-app>/.well-known/oauth-protected-resource` — JSON response shows the MCP server's resource metadata.

---

## RFC 9700 — OAuth 2.0 Security Best Current Practice

**Spec:** https://datatracker.ietf.org/doc/html/rfc9700  
**Status:** ✅ Applied (applicable controls)

| §BCP control | Implementation |
|---|---|
| §2.1 — `state` parameter (CSRF) | Generated + validated in callback |
| §2.1 — `nonce` in OIDC | Generated + validated against `id_token` |
| §2.1.1 — PKCE required | Enforced — no fallback to plain |
| §2.3 — Exact redirect URI | PingOne configured with exact URIs |
| §2.4 — Short-lived codes | Enforced by PingOne |
| §4.3 — Token leakage prevention | BFF custodian — tokens never in browser |

---

## OpenID Connect Core 1.0

**Spec:** https://openid.net/specs/openid-connect-core-1_0.html  
**Status:** ✅ Full

### How it's implemented

- `id_token` validated: signature (RS256 via JWKS) → `iss` → `aud` → `exp` → `nonce`
- `SKIP_TOKEN_SIGNATURE_VALIDATION=true` fatal in production (server exits on start)
- JWKS cached from `https://auth.pingone.com/{envId}/as/jwks`
- `sub` used as canonical user identifier

---

## OpenID CIBA Core 1.0

**Spec:** https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html  
**Status:** ✅ Full (poll mode)  
**Compliance notes:** Poll mode only — push mode not implemented. PingOne supports push via DaVinci flow, but the BFF uses poll.

### How it's implemented

| Step | Location |
|------|----------|
| `POST /bc-authorize` | `banking_api_server/routes/ciba.js` |
| Poll `POST /token grant_type=...ciba` | `banking_api_server/services/oauthService.js` |
| `authorization_pending` → retry | CIBA status handler with configurable interval |
| `slow_down` → interval += 5 | Backoff implemented |
| `access_denied` → abort | User rejected — error surfaced to agent |

### What you can demo

Ask the Banking Agent to transfer >$500 → CIBA OTP email sent → enter code in approval modal → agent resumes with elevated token.

---

## Model Context Protocol (MCP)

**Spec:** https://spec.modelcontextprotocol.io  
**Version:** 2025-03-26 (with 2024-11-05 compatibility)  
**Status:** ✅ Full (tool calling path)

### How it's implemented

- WebSocket server: `banking_mcp_server/src/` (TypeScript, `@modelcontextprotocol/sdk`)
- Tools registered: `get_my_accounts`, `get_account_balance`, `get_my_transactions`, `create_transfer`, `create_deposit`, `create_withdrawal`, `query_user_by_email`
- Auth challenge gating: MCP server sends `401` challenge before executing write tools without a valid scoped token
- BFF proxy: `banking_api_server/services/mcpWebSocketClient.js` — manages WS lifecycle, auth challenge response

### What you can demo

Admin → MCP Inspector → see `tools/list` live over WebSocket → initiate a tool call → watch the `tools/call` JSON-RPC exchange in the flow diagram.

---

## RFC 8707 — Resource Indicators

**Spec:** https://datatracker.ietf.org/doc/html/rfc8707  
**Status:** ✅ Partial  
**Compliance notes:** `audience` parameter is sent in every token exchange request and maps to the MCP resource server identifier. The `resource` parameter is not sent in the initial `/authorize` request (PingOne handles audience routing via app configuration instead).

---

## What's NOT Implemented (Honest Gaps)

| RFC / Feature | Gap | Reason |
|---|---|---|
| RFC 8705 — mTLS Client Auth | Not implemented | PingOne mTLS requires cert provisioning not suited to demo |
| RFC 9449 — DPoP | Not implemented | Demo scope; adds client-side key management complexity |
| PAR response validation | `request_uri` expiry not enforced client-side | PingOne handles server-side |
| Token exchange response JWKS validation | MCP token not re-validated via JWKS | Trusts PingOne TLS |
| FAPI 2.0 full compliance | Missing mTLS + DPoP | PKCE + PAR + PingOne hardening covers most controls |
| RFC 9396 RAR | Education panel only — not wired to authorization requests | Planned |
| Push CIBA | Poll mode only | PingOne push requires DaVinci flow |
| Recursive `act` nesting | Two-level nesting (`act.act.sub`) attempted in 2-exchange path; full nesting depends on PingOne SpEL support — fallback to single-level `act.sub` when SpEL cannot construct nested object | See `docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md §1e` |

---

## Standards & Frameworks

### Ping Identity AI Principles

The demo illustrates each principle:

| Principle | Demo feature |
|---|---|
| Authorised identity for agents | `may_act` on user token authorises BFF to exchange |
| Least-privilege scopes | Token exchange narrows from user scope to MCP tool scope |
| Auditable delegation chain | `act` claim + Token Chain visualiser records every hop |
| Human-in-the-loop controls | CIBA step-up + HITL consent modal for high-value actions |
| Revocable agent access | Token exchange token is short-lived; underlying session revocable |

### NIST SP 800-63B — Authentication Assurance Levels

| Level | Implementation |
|---|---|
| AAL1 | Password login via PingOne |
| AAL2 | MFA step-up (OTP email, TOTP, FIDO2) before high-value operations |
| AAL3 | FIDO2 hardware key (via PingOne MFA — depends on PingOne environment config) |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [`docs/FEATURES.md`](user-guide/FEATURES.md) | Sales/feature guide — what to show and how |
| [`docs/ARCHITECTURE_WALKTHROUGH.md`](ARCHITECTURE_WALKTHROUGH.md) | Technical walkthrough of all three auth flows |
| [`docs/PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md`](PINGONE_MAY_ACT_ONE_TOKEN_EXCHANGE.md) | PingOne setup for 1-exchange |
| [`docs/PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md`](PINGONE_MAY_ACT_TWO_TOKEN_EXCHANGES.md) | PingOne setup for 2-exchange |
| [`docs/ACT_CLAIM_VERIFICATION.md`](ACT_CLAIM_VERIFICATION.md) | act/may_act claim verification guide |
| [`docs/PINGONE_APP_SCOPE_MATRIX.md`](PINGONE_APP_SCOPE_MATRIX.md) | PingOne app scope configuration |
