# Token-Flow Audit — Super Banking demo

> **Historical note:** This is a forensic audit from 2026-05-13. The two-exchange path described was never in production — it was blocked upstream before reaching production and the failure was diagnosed here. Treat as historical reference only.

**Date:** 2026-05-13
**Trigger:** Chip end-to-end tests failing in both Single-Exchange and Two-Exchange paths with
`invalid_request: "Token exchange can only be used to issue tokens for custom resources"`
even after multiple provisioner fixes today.

**Scope:** Code-only audit of every token mint site, every token-exchange call site, the
audience each token is expected to carry, and the `act` / `may_act` chain expected
end-to-end.

**Conclusion (TL;DR):** Two-Exchange Step 1 cannot work as currently architected.
The AI Agent and MCP Exchanger apps are provisioned as PingOne `WORKER`-type apps,
which silently bind their client_credentials tokens to the PingOne Management API
audience (`https://api.pingone.com`), ignoring the `audience` parameter the BFF
passes. When that worker-aud token is used as the `actor_token` in Exchange #1
or #2, PingOne refuses because the actor is not a custom-resource token.

The fix is **app-type** — `WORKER` is wrong for agent CC tokens that need to bind
to a custom resource. RFC 8693 §1.1 architecture is correct: subject = user
token, actor = agent client identity (typically obtained via CC). The CC mint
itself is correct. The PingOne app type backing the CC mint is wrong.

---

## Section 1 — Token inventory

Tokens that appear in the chip-click flow, in mint order:

### T1. User access token (subject of every exchange)

| Property | Value |
|---|---|
| Minted by | PingOne `/as/token` (authorization_code grant) |
| Issuing app | Super Banking User App — `PINGONE_USER_CLIENT_ID` |
| App type | `WEB_APP` ✅ correct |
| `aud` (today) | `["banking_api_enduser"]` — Super Banking API resource ✅ correct |
| `scope` | `banking:read banking:write openid` |
| `may_act` | `{ "sub": "<MCP Exchanger client_id>" }` ✅ wired (provisioner step 23.5) |
| `act` | absent ✅ (this is the original token, not yet exchanged) |
| Used as | `subject_token` in Single-Exchange / Two-Ex Step 2 |

**Status: ✅ Correctly minted.** No issue with the user token.

### T2. AI Agent CC actor token (Two-Exchange Step 1)

| Property | Expected | Observed |
|---|---|---|
| Minted by | PingOne `/as/token` (client_credentials grant) with `audience=agent-gateway.ping.demo` | ditto |
| Issuing app | Super Banking AI Agent — `PINGONE_AI_AGENT_CLIENT_ID` | ditto |
| App type | something that respects `audience` on CC requests | **`WORKER`** ← wrong |
| `aud` | `["agent-gateway.ping.demo"]` (the Agent Gateway custom resource) | **`["https://api.pingone.com"]`** ← system Management API resource |
| `scope` | n/a for CC; binding is via audience | n/a |
| Used as | `actor_token` in Exchange #1 | breaks Exchange #1 |

**Status: ❌ Wrong PingOne app type.** Source: provisionService line 1801-1806 creates `Super Banking AI Agent` with `'WORKER'`.

### T3. MCP Exchanger CC actor token (Two-Exchange Step 3)

| Property | Expected | Observed |
|---|---|---|
| Minted by | PingOne `/as/token` (client_credentials grant) with `audience=api.ping.demo` | ditto |
| Issuing app | Super Banking MCP Exchanger — `PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID` / `AGENT_OAUTH_CLIENT_ID` | ditto |
| App type | something that respects `audience` on CC requests | **`WORKER`** ← wrong |
| `aud` | `["api.ping.demo"]` (the MCP Gateway custom resource) | **`["https://api.pingone.com"]`** ← system Management API resource |
| Used as | `actor_token` in Exchange #2 | breaks Exchange #2 |

**Status: ❌ Same problem as T2.** Source: provisionService line 1642-1647 creates `Super Banking MCP Exchanger` with `'WORKER'`.

### T4. Exchange #1 final token (Two-Exchange Step 2 output)

| Property | Expected |
|---|---|
| Minted by | PingOne `/as/token` (token-exchange grant), subject=T1, actor=T2 |
| `aud` | `["intermediate.2x.ping.demo"]` (Two-Exchange Intermediate custom resource) |
| `act.sub` | AI Agent client_id (Super Banking AI Agent) |
| `act.act` | absent (Step 1 is the first exchange) |
| `may_act` | inherited from T1 → MCP Exchanger client_id (allows it to do Exchange #2) |
| Used as | `subject_token` in Exchange #2 |

**Status: never minted — blocked by T2's wrong aud. T4 is not minted in production; the current production path is single-exchange only.**

### T5. Exchange #2 final MCP token (Two-Exchange Step 4 output)

| Property | Expected |
|---|---|
| Minted by | PingOne `/as/token` (token-exchange grant), subject=T4, actor=T3 |
| `aud` | `["final.2x.ping.demo"]` (Two-Exchange Final custom resource) |
| `act.sub` | MCP Exchanger client_id |
| `act.act.sub` | AI Agent client_id ← **the nested-delegation proof point** |
| `scope` | narrowed per tool requirements (e.g. `banking:read banking:mcp:invoke`) |
| Used as | Bearer in MCP Gateway HTTP / WebSocket call |

**Status: never minted — blocked upstream. T5 is not minted in production; the two-exchange delegation path was never in production.**

### T6. Single-Exchange final MCP token (alternative path)

| Property | Expected |
|---|---|
| Minted by | PingOne `/as/token` (token-exchange grant), subject=T1, actor=MCP Exchanger CC |
| Issuing exchanger | MCP Exchanger (`AGENT_OAUTH_CLIENT_ID`) when `USE_AGENT_ACTOR_FOR_MCP=true`; falls back to Admin App (`PINGONE_ADMIN_CLIENT_ID`) per `oauthService.performTokenExchange` line 253 |
| `aud` | `["mcp-server.ping.demo"]` (MCP Server custom resource) |
| `act.sub` | `AGENT_OAUTH_CLIENT_ID` (production) or Admin App client_id (fallback) |
| Used as | Bearer in MCP Gateway HTTP / WebSocket call |
| Trigger | when `ff_two_exchange_delegation=false` |

> **Correction:** This audit originally listed the Admin App (`PINGONE_ADMIN_CLIENT_ID`) as the sole exchanger for T6. In production, when `USE_AGENT_ACTOR_FOR_MCP=true` (the default), `AGENT_OAUTH_CLIENT_ID` is used as the actor. The Admin App is the fallback.

**Status: also blocked.** Admin App is `WEB_APP` type, but the Single-Exchange path here is `performTokenExchange` which authenticates the client via `client_secret_post` and asks PingOne to mint a delegated token directly — no separate CC actor token mint. May or may not work; we never landed here today because the flag was true.

---

## Section 2 — Token-exchange call sites

Every place the BFF asks PingOne for a token via `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`:

| File:line | Function | Caller | Subject | Actor | Exchanger client_id | Audience | Path |
|---|---|---|---|---|---|---|---|
| `oauthService.js:253` | `performTokenExchange(subject, aud, scopes)` | `agentMcpTokenService:496`, `agentMcpTokenService:1252` | T1 user token | none | **Admin App** (via `this.config.clientId`) | dynamic | Single-Exchange final |
| `oauthService.js:318` | `performTokenExchangeFromIdToken(idToken, aud, scopes)` | not currently called from chip path | T1 user id_token | none | Admin App | dynamic | unused |
| `oauthService.js:373` | `performTokenExchangeWithActor(subject, actor, aud, scopes)` | `agentMcpTokenService:492`, `agentMcpTokenService:1246` | T1 user token | T3 MCP Exchanger CC | Admin App | dynamic | hybrid path |
| `oauthService.js:724` | `performTokenExchangeAs(subject, actor, clientId, clientSecret, aud, scopes, method)` | `agentMcpTokenService:488`, `agentMcpTokenService:1242`, `agentMcpTokenService:1670` (**Two-Exchange Step 2**), `agentMcpTokenService:1792` (**Two-Exchange Step 4**) | varies | varies | **explicit param** (AI Agent for Step 2, MCP Exchanger for Step 4) | varies | Two-Exchange Steps 2 & 4 |
| `mfaService.js:119` | uses `performTokenExchange` for device-auth path | MFA flow only — not chip flow | T1 | none | Admin App | device-auth aud | orthogonal |

**Observation:** Only `performTokenExchangeAs` (the Two-Exchange path) uses CC actor tokens (T2/T3). The single-exchange paths via `performTokenExchange` and `performTokenExchangeWithActor` use the Admin App as the *requesting client* but rely on PingOne's policy to add the `act` claim — no separate CC actor token mint required. **The current chip-test failure mode (`invalid_grant`) is ALSO appearing on these paths — meaning the AI Agent / MCP Exchanger CC mint isn't the only issue.** The audit so far doesn't fully explain that.

---

## Section 3 — CC token mint sites

Every `getClientCredentialsToken*` call in the chip path:

| File:line | Function | App used | Audience requested | Audience actually issued |
|---|---|---|---|---|
| `agentMcpTokenService.js:1614` | Step 1 actor mint | **AI Agent** (`PINGONE_AI_AGENT_CLIENT_ID`) | `agent-gateway.ping.demo` | `https://api.pingone.com` ❌ |
| `agentMcpTokenService.js:1735` | Step 3 actor mint | **MCP Exchanger** (`PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID`) | `api.ping.demo` | `https://api.pingone.com` ❌ |
| `oauthService.js:474` `getAgentClientCredentialsToken()` | legacy path | Worker app | none | `https://api.pingone.com` ✅ (this is meant for Mgmt API calls) |
| `agentCCTokenService.js:58` | various | MCP Exchanger | optional | varies — `WORKER`-type, same problem |

**Root finding:** Both `agentMcpTokenService.js:1614` and `:1735` call `getClientCredentialsTokenAs` which sends `audience=` in the request body. PingOne silently ignores this parameter for `WORKER`-type apps and always issues a token with `aud=["https://api.pingone.com"]`.

---

## Section 4 — `may_act` / `act` chain expectations

The full delegation chain for a Two-Exchange chip click should produce:

```
T1 user token         may_act = { sub: <MCP Exchanger client_id> }
                                      ↓
T4 Exchange-#1 token  sub = <user>
                      aud = intermediate.2x.ping.demo
                      act = { sub: <AI Agent client_id> }       ← Agent acted on user
                      may_act = { sub: <MCP Exchanger client_id> } (inherited)
                                      ↓
T5 Exchange-#2 token  sub = <user>
                      aud = final.2x.ping.demo
                      act = { sub: <MCP Exchanger client_id>,    ← MCP Exchanger acted on
                              act: { sub: <AI Agent client_id> } } ← (Agent who acted on user)
```

**Provisioner-side checks** (`pingoneProvisionService.js`):

| Resource | `may_act` should be | `may_act` IS (per Section 3 in regression tests + live API GET) |
|---|---|---|
| Super Banking API (T1 aud=`banking_api_enduser`) | `{ sub: <MCP Exchanger client_id> }` | ✅ correct (line 1670) |
| MCP Server (Single-Exchange final aud) | `{ sub: <MCP Exchanger client_id> }` | ✅ correct (line 1677) |
| Two-Exchange Intermediate (T4 aud) | `{ sub: <AI Agent client_id> }` | ✅ correct (today's fix `6607559e`) |
| Two-Exchange Final (T5 aud) | `{ sub: <MCP Exchanger client_id> }` | ✅ correct (today's fix `6607559e`) |
| Agent Gateway (T2 aud) | n/a (Step 1 is CC mint, not exchange target) | none — by design |
| MCP Gateway (T3 aud) | n/a (Step 3 is CC mint, not exchange target) | none — by design |

**Verdict:** `may_act` wiring is all correct. The failure isn't here.

---

## Section 5 — Root cause restated

Token-exchange is failing on **every audience** because every call to mint an actor CC token comes back with `aud=["https://api.pingone.com"]` instead of the requested custom resource. PingOne's RFC 8693 endpoint then rejects the exchange because **the actor token's resource binding is the system Management API resource, not a custom one** — that's the literal meaning of the "Token exchange can only be used to issue tokens for custom resources" error message, applied to the **actor**, not the target audience.

The wrong layer is **the PingOne app type for AI Agent and MCP Exchanger**.

- `WORKER` app type → CC tokens are bound to PingOne Management API audience by default
- The `audience` parameter on the CC token request is **ignored** for WORKER apps
- WORKER apps cannot be given a scope grant to a custom resource (per `grantScopesToApplication` line 758-761: `"PingOne forbids resource access grants on WORKER apps for any resource other than 'openid'"`)
- WORKER apps use **role assignments** (not scope grants) to bind to custom resources — and the provisioner doesn't currently use role assignments

The intent at the **architecture** level is correct per RFC 8693 §1.1 — subject is the user token, actor is a client identity typically minted via CC. The mistake is the choice of `WORKER` for the PingOne app type. A `WORKER` in PingOne is specifically a "Management API admin" type. To mint a CC token bound to a custom resource, the agent identity needs to be either:

1. A non-WORKER app type that supports `client_credentials` grant + custom audience (likely `OPENID_CONNECT` with grant `client_credentials`, or a `SERVICE`-type), OR
2. A WORKER with role assignments to the custom resources via `POST /v1/environments/{envId}/applications/{appId}/roleAssignments` — but PingOne's role types don't include "may exchange tokens for resource X", so this isn't the right tool

---

## Section 6 — Proposed fixes

**Phase 1 — code change to provisioner (small):**

Replace `'WORKER'` with the correct app type for both:
- Super Banking AI Agent (`provisionService.js:1805`)
- Super Banking MCP Exchanger (`provisionService.js:1646`)

The correct type depends on what PingOne accepts. Most likely:
- `'OPENID_CONNECT'` (alias: `WEB_APP` or `NATIVE_APP`) with `tokenEndpointAuthMethod: 'client_secret_post'` + grants `['client_credentials', 'urn:ietf:params:oauth:grant-type:token-exchange']`
- OR `'CUSTOM'` if PingOne supports it for token-exchange clients

**Phase 2 — verify via direct API probe** (no setup:fresh impact yet):

```bash
# Read the App settings page for the new SERVICE / WEB_APP-with-CC app
# Mint a CC token explicitly requesting audience=<custom resource>
# Verify the token's aud claim matches what was requested
```

If PingOne issues a token with the custom aud (not `https://api.pingone.com`), the architecture is unblocked.

**Phase 3 — re-run setup:fresh + chip e2e test.**

---

## Section 7 — Don't-break list (do_not_break in §1 protected files)

- `pingoneProvisionService.js`: do not revert the AI Agent or MCP Exchanger apps to `'WORKER'`. This was today's discovery — that type silently binds CC tokens to the system API audience and breaks every Two-Exchange call.
- The `may_act` resource attributes on Two-Exchange Intermediate / Final / Super Banking API / MCP Server are all correct and must stay wired.
- The Admin app `TOKEN_EXCHANGE` grant reconcile (commit `6416f081`) is also correct — Single-Exchange paths use it.
- Do not remove the CC actor token mint steps from the Two-Exchange flow. RFC 8693 §1.1 requires an actor token to populate the `act` claim. The mint itself is correct; the app type backing it was wrong.

---

## Appendix — diagnostic commands used

| What | Command |
|---|---|
| List all custom resources + audiences | `node -e "<MCP Exchanger CC token + GET /v1/environments/{env}/resources>"` |
| Read may_act on a resource | `<...>/resources/{id}/attributes` |
| Mint a CC token + decode aud | `<Basic auth + grant_type=client_credentials + audience=<custom> + decode JWT>` |
| Verify Admin app grants | `<...>/applications/{adminId}` → check `grantTypes` |
| Trace BFF log | `grep -nE "TokenExchange:|CC-As|Exchange-As" /tmp/bank-api-server.log` |
